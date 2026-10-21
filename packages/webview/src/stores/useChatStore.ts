import { create } from 'zustand';

import { DEFAULT_APP_ID } from '@pi-code/shared/core/constants';
import { logger } from '@pi-code/shared/core/logger';
import { findModel, HISTORY_SCOPES } from '@pi-code/shared/core/protocol';
import { elapsedSeconds, resolveThinkingLevel } from '@pi-code/shared/utilities/common';
import {
  appendAssistantDelta,
  appendOnce,
  deliverQueuedReplies,
  ignoreUnknownSubagent,
  patchLastAssistant,
  patchReplyQueue,
  patchRetryDeadline,
  patchToolRow,
  resolveApproval,
  settlePendingTurns,
  startApiRequest,
  upsertToolRow,
} from '@pi-code/webview/helpers/messages';
import { findPendingQuestion } from '@pi-code/webview/helpers/questions';

import type { RefObject } from 'react';
import type { WebviewApi as InternalWebviewApi } from 'vscode-webview';
import type {
  CommandItem,
  CommitItem,
  ExtensionToWebviewMessage,
  HistoryItem,
  HistoryScope,
  ModelItem,
  ModelSelection,
  SubagentEvent,
  WebviewToExtensionMessage,
  WorkspaceFolderItem,
} from '@pi-code/shared/core/protocol';
import type { AppSettings } from '@pi-code/shared/core/settings';
import type { ActiveTaskState, Attachment, ChatMessage, ModelThinkingLevel, ToolChatMessage } from '@pi-code/shared/core/types';

interface WebviewApi extends Omit<InternalWebviewApi<unknown>, 'postMessage'> {
  postMessage(message: WebviewToExtensionMessage): void;
}

const vscode: WebviewApi | null = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

// Holds the composer's textarea ref without making it reactive store state:
// the element identity never changes per mount, so nothing should re-render
// when it is registered.
let composerTextarea: RefObject<HTMLTextAreaElement | null> | null = null;

export function setComposerTextarea(ref: RefObject<HTMLTextAreaElement | null> | null): void {
  composerTextarea = ref;
}

// Every scope gets the same fresh value, so the callback takes no argument.
function scopedRecord<T>(fill: () => T): Record<HistoryScope, T> {
  const record = {} as Record<HistoryScope, T>;
  for (const scope of HISTORY_SCOPES) record[scope] = fill();
  return record;
}

type ExtensionMessageHandler<T extends ExtensionToWebviewMessage['type']> = (
  msg: Extract<ExtensionToWebviewMessage, { type: T }>,
  scope: TaskScope,
) => void;

type ExtensionMessageMap = {
  readonly [T in ExtensionToWebviewMessage['type']]: ExtensionMessageHandler<T>;
};

type TaskScope = 'main' | 'subagent';

interface SubagentView {
  readonly toolCallId: string;
  readonly task: ActiveTaskState;
  readonly isRunning: boolean;
}

// Applies a change to the transcript the scope points at; events arriving for
// a scope with nothing open are dropped.
function patchTask(state: ChatState, scope: TaskScope, patch: (task: ActiveTaskState) => ActiveTaskState): Partial<ChatState> {
  if (scope === 'subagent') {
    if (!state.subagent) return {};
    return { subagent: { ...state.subagent, task: patch(state.subagent.task) } };
  }
  if (!state.activeTask) return {};
  return { activeTask: patch(state.activeTask) };
}

function patchRunning(state: ChatState, scope: TaskScope, running: boolean): Partial<ChatState> {
  if (scope === 'subagent') {
    if (!state.subagent) return {};
    return { subagent: { ...state.subagent, isRunning: running } };
  }
  return { isRunning: running };
}

// Approval and start events create or refresh one tool row, settling any turns
// still marked running before it.
function applyToolUpsert(task: ActiveTaskState, id: string, patch: Partial<ToolChatMessage>): ActiveTaskState {
  return { ...task, messages: upsertToolRow(task.messages, id, patch) };
}

interface ChatState {
  readonly activeTask: ActiveTaskState | null;
  readonly subagent: SubagentView | null;
  readonly openableSubagents: readonly string[];
  readonly isRunning: boolean;
  readonly isCompacting: boolean;
  readonly view: 'chat' | 'history' | 'settings' | 'subagent';
  readonly inputValue: string;
  readonly inputAttachments: Attachment[];
  readonly models: ModelItem[];
  readonly settings: AppSettings | null;
  readonly commands: CommandItem[];
  readonly selectedModel: ModelSelection;
  readonly selectedThinkingLevel: ModelThinkingLevel | null;
  readonly scope: HistoryScope;
  readonly historyByScope: Record<HistoryScope, HistoryItem[]>;
  readonly searchResults: string[];
  readonly commitResults: CommitItem[] | null;
  readonly openedSettingsFromHistory: boolean;
  readonly latestEpoch: Record<HistoryScope, number>;
  readonly fetchedScopes: Set<HistoryScope>;
  readonly activeWorkspace: string;
  readonly workspaceFolders: WorkspaceFolderItem[];

  readonly send: (message: WebviewToExtensionMessage) => void;
  readonly compact: () => void;
  readonly setSelectedModel: (model: ModelItem) => void;
  readonly setSelectedThinkingLevel: (level: ModelThinkingLevel | null) => void;
  readonly getHistory: (scope: HistoryScope) => void;
  readonly deleteSessions: (paths: string[]) => void;
  readonly applyMessage: (msg: ExtensionToWebviewMessage) => void;
  readonly setActiveTask: (value: ActiveTaskState | null | ((prev: ActiveTaskState | null) => ActiveTaskState | null)) => void;
  readonly setSubagent: (value: SubagentView | null) => void;
  readonly respondToApproval: (msgId: string, approved: boolean) => void;
  readonly setIsRunning: (value: boolean) => void;
  readonly setView: (view: ChatState['view']) => void;
  readonly setInputValue: (value: string) => void;
  readonly setInputAttachments: (value: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void;
  readonly appendToInput: (text: string) => void;
  readonly setScope: (scope: HistoryScope) => void;
  readonly selectWorkspace: (path: string) => void;
  readonly openSubagentSession: (toolCallId: string) => void;
  readonly closeSubagentSession: () => void;
}

const NO_MODEL: ModelSelection = { id: 'unknown', provider: DEFAULT_APP_ID };

function toSelection(model: ModelItem | ModelSelection | undefined): ModelSelection {
  return model ? { id: model.id, provider: model.provider } : NO_MODEL;
}

export const useChatStore = create<ChatState>((set, get) => {
  let latestSearchQuery = '';
  let latestCommitQuery = '';
  let defaultModel: ModelSelection | undefined;

  const messageHandlers: ExtensionMessageMap = {
    session_loaded: (msg) => {
      set((state) => ({
        activeTask: msg.payload,
        isRunning: false,
        isCompacting: false,
        // A sub-agent session stays on screen; the task behind it is replaced.
        view: state.view === 'subagent' ? 'subagent' : 'chat',
      }));
    },
    // The banner is owned by this pair alone. An auto-compaction outlives the
    // turn that triggered it, so agent_settled and the follow-up agent_start
    // both land while the summarization request is still in flight.
    compaction_start: (_msg) => {
      set({ isCompacting: true });
    },
    compaction_end: (msg) => {
      set((state) => {
        const { compactionEntry, ...stats } = msg.payload ?? {};
        return {
          isCompacting: false,
          ...patchTask(state, 'main', (task) => ({
            ...task,
            ...stats,
            // The summary is the only record of what compaction dropped, so it
            // joins the transcript as its own row. A payload without an entry
            // (a cancelled run) only refreshes the header.
            messages: compactionEntry
              ? [
                  ...task.messages,
                  {
                    id: compactionEntry.id,
                    sender: 'compaction' as const,
                    text: compactionEntry.summary,
                    cost: compactionEntry.usage?.cost?.total,
                    timestamp: Date.now(),
                  },
                ]
              : task.messages,
          })),
        };
      });
    },
    reply_queue_data: (msg) => {
      set((state) => patchTask(state, 'main', (task) => ({ ...task, messages: patchReplyQueue(task.messages, msg.payload.queue) })));
    },
    reply_queue_delivered: (msg) => {
      set((state) => patchTask(state, 'main', (task) => ({ ...task, messages: deliverQueuedReplies(task.messages, msg.payload.messages) })));
    },
    agent_start: (msg, scope) => {
      const { path, stats } = msg.payload;
      set((state) => ({
        ...patchRunning(state, scope, true),
        ...patchTask(state, scope, (task) => ({ ...task, path: path ?? task.path, ...stats })),
      }));
    },
    message_start: (msg, scope) => {
      const { timestamp } = msg.payload;
      set((state) =>
        patchTask(state, scope, (task) => ({
          ...task,
          messages: [
            ...settlePendingTurns(task.messages),
            { id: `assistant-${timestamp}`, sender: 'assistant', text: '', timestamp, toolStatus: 'running' },
          ],
        })),
      );
    },
    api_request_start: (msg, scope) => {
      const { id, timestamp } = msg.payload;
      set((state) =>
        patchTask(state, scope, (task) => {
          const messages = startApiRequest(task.messages, id, timestamp);
          return messages === task.messages ? task : { ...task, messages };
        }),
      );
    },
    api_request_end: (msg, scope) => {
      const { id, cost, error, stats } = msg.payload;
      set((state) =>
        patchTask(state, scope, (task) => {
          // A turn that never got its own row still has to close, so the id is
          // only honoured when a matching request row is actually on screen.
          const rowExists = task.messages.some((m) => m.id === id && m.sender === 'api_request');
          const messages = settlePendingTurns(task.messages, { cost, error }, rowExists ? id : undefined);
          return { ...task, messages, ...stats };
        }),
      );
    },
    api_retry_start: (msg, scope) => {
      const { delayMs } = msg.payload;
      set((state) => patchTask(state, scope, (task) => ({ ...task, messages: patchRetryDeadline(task.messages, Date.now() + delayMs) })));
    },
    api_retry_end: (_msg, scope) => {
      set((state) => patchTask(state, scope, (task) => ({ ...task, messages: patchRetryDeadline(task.messages, undefined) })));
    },
    message_end: (msg, scope) => {
      const { cost, stats } = msg.payload;
      set((state) =>
        patchTask(state, scope, (task) => ({
          ...task,
          messages: patchLastAssistant(task.messages, (message) => ({
            toolStatus: 'completed',
            cost: cost ?? message.cost,
          })),
          ...stats,
        })),
      );
    },
    stream_delta: (msg, scope) => {
      const { text, thinking } = msg.payload;
      set((state) =>
        patchTask(state, scope, (task) => ({
          ...task,
          messages: appendAssistantDelta(task.messages, text, thinking),
        })),
      );
    },
    tool_approval_request: (msg) => {
      const { id, tool_name, arguments: toolArgs, subagent, toolCallId } = msg.payload;
      const patch: Partial<ToolChatMessage> = {
        text: tool_name,
        toolName: tool_name,
        toolArgs,
        toolStatus: 'approval',
        subagent,
        toolCallId,
        pausedAt: Date.now(),
      };
      set((state) => {
        // The approval belongs to the sub-agent that asked for it and to the
        // task that waits on it, so it is shown in both. Leaving the sub-agent
        // session must never take the only copy of a call the user has to
        // answer with.
        const inTask = patchTask(state, 'main', (task) => applyToolUpsert(task, id, patch));
        const inSubagent =
          toolCallId && toolCallId === state.subagent?.toolCallId ? patchTask(state, 'subagent', (task) => applyToolUpsert(task, id, patch)) : {};
        return { ...inTask, ...inSubagent };
      });
    },
    tool_execution_start: (msg, scope) => {
      const { id, tool_name, arguments: toolArgs, subagent } = msg.payload;
      set((state) => ({
        ...patchRunning(state, scope, true),
        ...patchTask(state, scope, (task) =>
          // A sub-agent's own tool calls belong to the row the parent
          // sub-agent call already opened, so they never create a row of
          // their own.
          ignoreUnknownSubagent(task.messages, subagent, id)
            ? task
            : applyToolUpsert(task, id, { text: tool_name, toolName: tool_name, toolArgs, toolStatus: 'running', subagent }),
        ),
      }));
    },
    tool_execution_update: (msg, scope) => {
      const { id, result, subagent, subtitle } = msg.payload;
      set((state) =>
        patchTask(state, scope, (task) => {
          const messages = patchToolRow(task.messages, id, subagent, (target) => {
            // A command reports its output in pieces that belong together, so
            // they pile up on the row instead of replacing each other.
            if (target.toolName === 'execute_command') {
              return { diff: `${target.diff ?? ''}${result}`, subtitle };
            }
            // A sub-agent reports its first result only once, so the row's
            // clock starts there rather than at the approval.
            const startedNow = target.toolName === 'spawn_subagent' && target.diff === undefined;
            return startedNow ? { diff: result, subtitle, timestamp: Date.now() } : { diff: result, subtitle };
          });
          return messages === task.messages ? task : { ...task, messages };
        }),
      );
    },
    tool_execution_end: (msg, scope) => {
      const { id, result, diff, duration, todos, files, is_error, exit_code, cancelled, subagent, subtitle } = msg.payload;
      set((state) =>
        patchTask(state, scope, (task) => {
          const messages = patchToolRow(task.messages, id, subagent, (target) => {
            // A tool that measures its own work owns the numbers, and the
            // transcript replay path trusts the same two fields. Only tools that
            // report nothing fall back to what the row can work out itself.
            const elapsed = elapsedSeconds(target.timestamp);
            return {
              todos,
              files,
              // A call the user stopped is neither a denial nor a failure.
              toolStatus: cancelled ? ('cancelled' as const) : is_error ? ('denied' as const) : ('completed' as const),
              exitCode: exit_code,
              diff: diff ?? result,
              duration: duration ?? elapsed,
              subtitle,
            };
          });
          return messages === task.messages ? task : { ...task, messages };
        }),
      );
    },
    agent_error: (msg, scope) => {
      const { message } = msg.payload;
      set((state) => ({
        ...patchRunning(state, scope, false),
        ...patchTask(state, scope, (task) => ({
          ...task,
          messages: appendOnce(settlePendingTurns(task.messages, { error: message }), {
            id: crypto.randomUUID(),
            sender: 'error',
            text: message,
            errorMessage: message,
            timestamp: Date.now(),
          }),
        })),
      }));
    },
    agent_settled: (msg, scope) => {
      set((state) => ({
        ...patchRunning(state, scope, false),
        ...patchTask(state, scope, (task) => ({ ...task, messages: settlePendingTurns(task.messages), ...msg.payload })),
      }));
    },
    archive_result: (msg) => {
      const { id, path, archived, title } = msg.payload;
      set((state) => {
        const item: HistoryItem = { id, path, task: title, timestamp: Date.now() };
        const next = { ...state.historyByScope };
        // Archiving and unarchiving move the row the same way in both scopes;
        // only the archive list itself is invalidated below.
        for (const scope of ['current', 'all'] as const) {
          const remaining = state.historyByScope[scope].filter((entry) => entry.id !== id);
          next[scope] = archived ? remaining : [item, ...remaining];
        }
        const activeTask = state.activeTask && state.activeTask.id === id ? { ...state.activeTask, path, isArchived: archived } : state.activeTask;
        const fetchedScopes = new Set(state.fetchedScopes);
        fetchedScopes.delete('archives');
        fetchedScopes.delete('all');
        return { historyByScope: next, activeTask, fetchedScopes };
      });
    },
    show_settings: (_msg) => {
      set((state) => ({ view: 'settings', openedSettingsFromHistory: state.view === 'history' }));
    },
    set_chat_input: (msg) => {
      get().appendToInput(msg.payload.text);
    },
    init_data: (msg) => {
      const { models, default_model, default_thinking_level, settings, commands, log_level } = msg.payload;
      logger.setLevel(log_level);
      const selectedModel = default_model ?? models[0];
      defaultModel = default_model;
      set({
        models,
        settings: settings ?? null,
        commands: commands ?? [],
        selectedModel: toSelection(selectedModel),
        selectedThinkingLevel: default_thinking_level ?? null,
        fetchedScopes: new Set<HistoryScope>(['current']),
        latestEpoch: scopedRecord(() => 0),
      });
    },
    commands_data: (msg) => {
      set({ commands: msg.payload.commands });
    },
    models_data: (msg) => {
      const models = msg.payload.models;
      const { selectedModel, selectedThinkingLevel } = get();
      // The persisted selection wins only while the refreshed catalog still
      // carries that exact provider and model.
      const next = findModel(models, selectedModel) ?? findModel(models, defaultModel) ?? models[0];
      set({
        models,
        selectedModel: toSelection(next),
        selectedThinkingLevel: resolveThinkingLevel(next?.thinkingLevels ?? [], selectedThinkingLevel),
      });
    },
    settings_data: (msg) => {
      set({ settings: msg.payload.settings });
    },
    history_data: (msg) => {
      const { scope, epoch, items } = msg.payload;
      const prevEpoch = get().latestEpoch[scope];
      if (epoch < prevEpoch) return;
      const isNewRefresh = epoch > prevEpoch;
      set((state) => ({
        latestEpoch: { ...state.latestEpoch, [scope]: epoch },
        historyByScope: {
          ...state.historyByScope,
          [scope]: isNewRefresh ? items : [...state.historyByScope[scope], ...items],
        },
      }));
    },
    search_results: (msg) => {
      if (msg.payload.query === latestSearchQuery) {
        set({ searchResults: msg.payload.paths });
      }
    },
    commit_results: (msg) => {
      if (msg.payload.query === latestCommitQuery) {
        set({ commitResults: msg.payload.commits });
      }
    },
    workspace_data: (msg) => {
      set({ workspaceFolders: msg.payload.folders, activeWorkspace: msg.payload.active });
    },
    subagent_session_opened: (msg) => {
      const { toolCallId, task, isRunning } = msg.payload;
      set({ subagent: { toolCallId, task, isRunning }, view: 'subagent' });
    },
    subagent_sessions: (msg) => {
      set({ openableSubagents: msg.payload.toolCallIds });
    },
    subagent_event: (msg) => {
      const { toolCallId, event } = msg.payload;
      // An event for a sub-agent that is no longer on screen has nowhere to go.
      if (get().subagent?.toolCallId !== toolCallId) return;
      applyToScope(event, 'subagent');
    },
  };

  // Routes an event to the transcript the scope points at.
  function applyToScope(event: SubagentEvent, scope: TaskScope): void {
    const handler = messageHandlers[event.type] as ExtensionMessageHandler<typeof event.type>;
    handler(event, scope);
  }

  return {
    activeTask: null,
    subagent: null,
    openableSubagents: [],
    isRunning: false,
    isCompacting: false,
    view: 'chat',
    inputValue: '',
    inputAttachments: [],
    models: [],
    settings: null,
    commands: [],
    selectedModel: NO_MODEL,
    selectedThinkingLevel: null,
    scope: 'current',
    historyByScope: scopedRecord<HistoryItem[]>(() => []),
    searchResults: [],
    commitResults: null,
    openedSettingsFromHistory: false,
    latestEpoch: scopedRecord(() => 0),
    fetchedScopes: new Set<HistoryScope>(['current']),
    activeWorkspace: '',
    workspaceFolders: [],

    send: (message) => {
      if (message.type === 'search_files') latestSearchQuery = message.query;
      if (message.type === 'search_commits') latestCommitQuery = message.query;
      vscode?.postMessage(message);
    },

    compact: () => {
      const { activeTask } = get();
      get().send({
        type: 'builtin_command',
        command: 'compact',
        id: activeTask?.id ?? '',
        path: activeTask?.path,
        title: activeTask?.title ?? '',
      });
    },

    setSelectedModel: (model) => {
      const { selectedThinkingLevel } = get();
      const level = resolveThinkingLevel(model.thinkingLevels ?? [], selectedThinkingLevel);
      const selection: ModelSelection = { id: model.id, provider: model.provider };
      set({ selectedModel: selection, selectedThinkingLevel: level });
      get().send({ type: 'set_model', model: selection, thinkingLevel: level ?? undefined });
    },

    setSelectedThinkingLevel: (level) => {
      set({ selectedThinkingLevel: level });
      // The selection already carries its provider, so the level change never
      // has to guess which catalog entry the id belonged to.
      get().send({ type: 'set_model', model: get().selectedModel, thinkingLevel: level ?? undefined });
    },

    getHistory: (scope) => {
      const fetched = get().fetchedScopes;
      if (fetched.has(scope)) return;
      const next = new Set(fetched);
      next.add(scope);
      set({ fetchedScopes: next });
      get().send({ type: 'get_history', scope });
    },

    deleteSessions: (paths) => {
      const removed = new Set(paths);
      set((state) => {
        const next = { ...state.historyByScope };
        for (const target of HISTORY_SCOPES) {
          next[target] = state.historyByScope[target].filter((item) => !removed.has(item.path));
        }
        return { historyByScope: next };
      });
      get().send({ type: 'delete_sessions', paths });
    },

    applyMessage: (msg) => {
      // The handler map covers every message type, so the lookup cannot miss.
      (messageHandlers[msg.type] as ExtensionMessageHandler<typeof msg.type>)(msg, 'main');
    },

    setActiveTask: (value) =>
      set((state) => ({
        activeTask: typeof value === 'function' ? (value as (prev: ActiveTaskState | null) => ActiveTaskState | null)(state.activeTask) : value,
      })),

    setSubagent: (value) => set({ subagent: value }),

    // The approval row lives in the task and, while its sub-agent is open, in
    // the sub-agent session too. Answering it settles both copies.
    respondToApproval: (msgId, approved) => {
      set((state) => {
        const inTask = patchTask(state, 'main', (task) => ({
          ...task,
          messages: resolveApproval(task.messages, msgId, approved),
        }));
        const inSubagent = state.subagent
          ? patchTask(state, 'subagent', (task) => ({
              ...task,
              messages: resolveApproval(task.messages, msgId, approved),
            }))
          : {};
        return { ...inTask, ...inSubagent };
      });
    },

    setIsRunning: (value) => set({ isRunning: value }),

    setView: (value) => set({ view: value }),

    setInputValue: (value) => set({ inputValue: value }),

    setInputAttachments: (value) => set((state) => ({ inputAttachments: typeof value === 'function' ? value(state.inputAttachments) : value })),

    appendToInput: (text) => {
      const textarea = composerTextarea?.current;
      // Before the composer mounts there is no caret to insert at, so append.
      if (!textarea) {
        set((state) => ({ inputValue: state.inputValue ? `${state.inputValue}${text}` : text }));
        return;
      }

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      set((state) => ({ inputValue: state.inputValue.slice(0, start) + text + state.inputValue.slice(end) }));
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + text.length, start + text.length);
      }, 0);
    },

    setScope: (scope) => set({ scope }),

    // Switching folders invalidates everything scoped to the old cwd: cached
    // history lists and file-search results. The re-init refetches models,
    // settings, commands, and history for the new folder. fetchedScopes resets
    // here too, so no scope from the old workspace can mask an empty list
    // during the window before init_data arrives.
    selectWorkspace: (path) => {
      if (path === get().activeWorkspace) return;
      set({
        activeWorkspace: path,
        historyByScope: scopedRecord<HistoryItem[]>(() => []),
        searchResults: [],
        commitResults: null,
        fetchedScopes: new Set<HistoryScope>(['current']),
      });
      get().send({ type: 'select_workspace', path });
      get().send({ type: 'init' });
    },

    openSubagentSession: (toolCallId) => {
      get().send({ type: 'open_subagent_session', tool_call_id: toolCallId });
    },

    closeSubagentSession: () => {
      get().send({ type: 'close_subagent_session' });
      set({ subagent: null, view: 'chat' });
    },
  };
});

let pendingQuestionSource: readonly ChatMessage[] | undefined;
let pendingQuestionResult: ChatMessage | undefined;

export const selectPendingQuestion = (state: ChatState): ChatMessage | undefined => {
  const messages = state.activeTask?.messages;
  if (messages !== undefined && messages === pendingQuestionSource) return pendingQuestionResult;
  pendingQuestionSource = messages;
  pendingQuestionResult = findPendingQuestion(messages ?? []);
  return pendingQuestionResult;
};

// The level shown to the user, clamped to what the selected model supports.
// The stored value is the raw preference, so a catalog refresh never has to
// write back to the store to keep the display valid.
export const selectThinkingLevel = (state: ChatState): ModelThinkingLevel | null => {
  const levels = findModel(state.models, state.selectedModel)?.thinkingLevels ?? [];
  return resolveThinkingLevel(levels, state.selectedThinkingLevel);
};

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    try {
      useChatStore.getState().applyMessage(event.data as ExtensionToWebviewMessage);
    } catch (err) {
      logger.error('Failed to handle webview message:', err);
    }
  });
}

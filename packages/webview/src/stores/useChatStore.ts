import { create } from 'zustand';

import { DEFAULT_APP_ID } from '@pi-code/shared/core/constants';
import { logger } from '@pi-code/shared/core/logger';
import { HISTORY_SCOPES } from '@pi-code/shared/core/protocol';
import { defaultThinkingLevel, elapsedSeconds } from '@pi-code/shared/utilities/common';
import {
  appendOnce,
  deliverQueuedReplies,
  ignoreUnknownSubagent,
  patchLastAssistant,
  patchMessage,
  rebuildToolSections,
  settlePendingTurns,
  upsertToolMessage,
} from '@pi-code/webview/components/chat/helpers/message';
import { findPendingQuestion } from '@pi-code/webview/components/chat/helpers/question';

import type { RefObject } from 'react';
import type { WebviewApi as InternalWebviewApi } from 'vscode-webview';
import type {
  CommandItem,
  ExtensionToWebviewMessage,
  HistoryItem,
  HistoryScope,
  ModelItem,
  WebviewToExtensionMessage,
} from '@pi-code/shared/core/protocol';
import type { AppSettings } from '@pi-code/shared/core/settings';
import type { ActiveTaskState, ApiRequestChatMessage, ChatMessage, ModelThinkingLevel } from '@pi-code/shared/core/types';

interface WebviewApi extends Omit<InternalWebviewApi<unknown>, 'postMessage'> {
  postMessage(message: WebviewToExtensionMessage): void;
}

const vscode: WebviewApi | null = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

function zeroEpochs(): Record<HistoryScope, number> {
  const record = {} as Record<HistoryScope, number>;
  for (const scope of HISTORY_SCOPES) record[scope] = 0;
  return record;
}

function emptyHistoryByScope(): Record<HistoryScope, HistoryItem[]> {
  const record = {} as Record<HistoryScope, HistoryItem[]>;
  for (const scope of HISTORY_SCOPES) record[scope] = [];
  return record;
}

type ExtensionMessageHandler<T extends ExtensionToWebviewMessage['type']> = (msg: Extract<ExtensionToWebviewMessage, { type: T }>) => void;

type ExtensionMessageMap = {
  readonly [T in ExtensionToWebviewMessage['type']]: ExtensionMessageHandler<T>;
};

interface ChatState {
  readonly activeTask: ActiveTaskState | null;
  readonly isRunning: boolean;
  readonly isCompacting: boolean;
  readonly view: 'chat' | 'history' | 'settings';
  readonly inputValue: string;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null> | null;
  readonly models: ModelItem[];
  readonly settings: AppSettings | null;
  readonly commands: CommandItem[];
  readonly selectedModel: string;
  readonly selectedThinkingLevel: ModelThinkingLevel | null;
  readonly scope: HistoryScope;
  readonly historyByScope: Record<HistoryScope, HistoryItem[]>;
  readonly searchResults: string[];
  readonly openedSettingsFromHistory: boolean;
  readonly latestEpoch: Record<HistoryScope, number>;
  readonly fetchedScopes: Set<HistoryScope>;
  readonly searchRequestId: string;

  readonly send: (message: WebviewToExtensionMessage) => void;
  readonly compact: () => void;
  readonly setSelectedModel: (id: string) => void;
  readonly setSelectedThinkingLevel: (level: ModelThinkingLevel | null) => void;
  readonly syncSelectedThinkingLevel: (level: ModelThinkingLevel | null) => void;
  readonly getHistory: (scope: HistoryScope) => void;
  readonly deleteSessions: (paths: string[]) => void;
  readonly applyMessage: (msg: ExtensionToWebviewMessage) => void;
  readonly setActiveTask: (value: ActiveTaskState | null | ((prev: ActiveTaskState | null) => ActiveTaskState | null)) => void;
  readonly setIsRunning: (value: boolean) => void;
  readonly setView: (view: ChatState['view']) => void;
  readonly setInputValue: (value: string) => void;
  readonly setTextareaRef: (ref: RefObject<HTMLTextAreaElement | null> | null) => void;
  readonly appendToInput: (text: string) => void;
  readonly setScope: (scope: HistoryScope) => void;
}

export const useChatStore = create<ChatState>((set, get) => {
  const messageHandlers: ExtensionMessageMap = {
    session_loaded: (msg) => {
      set({ activeTask: msg.payload, isRunning: false, isCompacting: false, view: 'chat' });
    },
    compaction_start: (_msg) => {
      set({ isCompacting: true });
    },
    compaction_end: (msg) => {
      set((state) => ({
        isCompacting: false,
        activeTask: state.activeTask ? { ...state.activeTask, ...msg.payload } : state.activeTask,
      }));
    },
    reply_queue_data: (msg) => {
      set((state) => ({
        activeTask: state.activeTask
          ? { ...state.activeTask, messages: [...state.activeTask.messages.filter((m) => m.sender !== 'queue'), ...msg.payload.queue] }
          : state.activeTask,
      }));
    },
    reply_queue_delivered: (msg) => {
      set((state) => ({
        activeTask: state.activeTask
          ? { ...state.activeTask, messages: deliverQueuedReplies(state.activeTask.messages, msg.payload.messages) }
          : state.activeTask,
      }));
    },
    agent_start: (msg) => {
      const { path, stats } = msg.payload;
      set((state) => ({
        isRunning: true,
        activeTask: state.activeTask ? { ...state.activeTask, path: path ?? state.activeTask.path, ...stats } : state.activeTask,
      }));
    },
    message_start: (msg) => {
      const { timestamp } = msg.payload;
      set((state) => ({
        isRunning: true,
        activeTask: state.activeTask
          ? {
              ...state.activeTask,
              messages: [
                ...settlePendingTurns(state.activeTask.messages),
                { id: `assistant-${timestamp}`, sender: 'assistant', text: '', ts: timestamp, toolStatus: 'running' },
              ],
            }
          : state.activeTask,
      }));
    },
    api_request_start: (msg) => {
      const { id, timestamp } = msg.payload;
      set((state) => ({
        isRunning: true,
        activeTask: state.activeTask
          ? {
              ...state.activeTask,
              messages: state.activeTask.messages.some((m) => m.id === id)
                ? state.activeTask.messages
                : [
                    ...settlePendingTurns(state.activeTask.messages),
                    { id, sender: 'api_request', text: 'API Request', ts: timestamp, toolStatus: 'running' },
                  ],
            }
          : state.activeTask,
      }));
    },
    api_request_end: (msg) => {
      const { id, cost, error, stats } = msg.payload;
      set((state) => {
        if (!state.activeTask) return {};
        const target = state.activeTask.messages.find((m) => m.id === id && m.sender === 'api_request') as ApiRequestChatMessage | undefined;
        let messages = target
          ? patchMessage(state.activeTask.messages, id, {
              toolStatus: error ? 'denied' : 'completed',
              cost: cost ?? target.cost,
              errorMessage: error ?? target.errorMessage,
            })
          : settlePendingTurns(state.activeTask.messages, { cost, error });
        if (error) {
          messages = appendOnce(messages, { id: `${id}-error`, sender: 'error', text: error, errorMessage: error, ts: Date.now() });
        }
        return { activeTask: { ...state.activeTask, messages, ...stats } };
      });
    },
    message_end: (msg) => {
      const { cost, stats } = msg.payload;
      set((state) => ({
        activeTask: state.activeTask
          ? {
              ...state.activeTask,
              messages: patchLastAssistant(state.activeTask.messages, (message) => ({
                toolStatus: 'completed',
                cost: cost ?? message.cost,
              })),
              ...stats,
            }
          : state.activeTask,
      }));
    },
    stream_delta: (msg) => {
      const { text, thinking } = msg.payload;
      set((state) => ({
        activeTask: state.activeTask
          ? {
              ...state.activeTask,
              messages: patchLastAssistant(state.activeTask.messages, (message) => ({
                text: text ? message.text + text : message.text,
                reasoning: thinking ? (message.reasoning || '') + thinking : message.reasoning,
              })),
            }
          : state.activeTask,
      }));
    },
    tool_approval_request: (msg) => {
      const { id, tool_name, arguments: toolArgs, subagent, toolCallId } = msg.payload;
      set((state) => ({
        activeTask: state.activeTask
          ? {
              ...state.activeTask,
              messages: rebuildToolSections(
                upsertToolMessage(settlePendingTurns(state.activeTask.messages), id, {
                  text: tool_name,
                  toolName: tool_name,
                  toolArgs,
                  toolStatus: 'approval',
                  subagent,
                  toolCallId,
                  pausedAt: Date.now(),
                }),
                id,
              ),
            }
          : state.activeTask,
      }));
    },
    tool_execution_start: (msg) => {
      const { id, tool_name, arguments: toolArgs, subagent } = msg.payload;
      set((state) => ({
        isRunning: true,
        activeTask: state.activeTask
          ? {
              ...state.activeTask,
              messages: ignoreUnknownSubagent(state.activeTask.messages, subagent, id)
                ? state.activeTask.messages
                : rebuildToolSections(
                    upsertToolMessage(settlePendingTurns(state.activeTask.messages), id, {
                      text: tool_name,
                      toolName: tool_name,
                      toolArgs,
                      toolStatus: 'running',
                      subagent,
                    }),
                    id,
                  ),
            }
          : state.activeTask,
      }));
    },
    tool_execution_update: (msg) => {
      const { id, result, subagent, subtitle } = msg.payload;
      set((state) => {
        if (!state.activeTask) return {};
        const messages = state.activeTask.messages;
        if (ignoreUnknownSubagent(messages, subagent, id)) return { activeTask: state.activeTask };
        const target = messages.find((m) => m.id === id);
        if (target?.sender === 'tool' && target.toolName === 'execute_command') {
          return {
            activeTask: {
              ...state.activeTask,
              messages: rebuildToolSections(patchMessage(messages, id, { diff: `${target.diff ?? ''}${result}`, subtitle }), id),
            },
          };
        }
        const isSubagent = target?.sender === 'tool' && target.toolName === 'spawn_subagent';
        const startedNow = isSubagent && target.diff === undefined;
        const patch = startedNow ? { diff: result, subtitle, ts: Date.now() } : { diff: result, subtitle };
        return {
          activeTask: { ...state.activeTask, messages: rebuildToolSections(patchMessage(messages, id, patch), id) },
        };
      });
    },
    tool_execution_end: (msg) => {
      const { id, result, todos, files, is_error, subagent, subtitle } = msg.payload;
      set((state) => {
        if (!state.activeTask) return {};
        const messages = state.activeTask.messages;
        if (ignoreUnknownSubagent(messages, subagent, id)) return { activeTask: state.activeTask };
        const existing = messages.find((m) => m.id === id);
        const duration = existing ? elapsedSeconds(existing.ts) : undefined;
        return {
          activeTask: {
            ...state.activeTask,
            messages: rebuildToolSections(
              patchMessage(messages, id, {
                todos,
                files,
                toolStatus: is_error ? 'denied' : 'completed',
                diff: result,
                duration,
                subtitle,
              }),
              id,
            ),
          },
        };
      });
    },
    agent_error: (msg) => {
      const { message } = msg.payload;
      set((state) => {
        if (!state.activeTask) return { isRunning: false };
        return {
          isRunning: false,
          activeTask: {
            ...state.activeTask,
            messages: appendOnce(settlePendingTurns(state.activeTask.messages, { error: message }), {
              id: crypto.randomUUID(),
              sender: 'error',
              text: message,
              errorMessage: message,
              ts: Date.now(),
            }),
          },
        };
      });
    },
    agent_settled: (msg) => {
      set((state) => ({
        isRunning: false,
        isCompacting: false,
        activeTask: state.activeTask
          ? { ...state.activeTask, messages: settlePendingTurns(state.activeTask.messages), ...msg.payload }
          : state.activeTask,
      }));
    },
    archive_result: (msg) => {
      const { id, path, archived, title } = msg.payload;
      set((state) => {
        const item: HistoryItem = { id, path, task: title, ts: Date.now() };
        const next = { ...state.historyByScope };
        if (archived) {
          next.current = state.historyByScope.current.filter((e) => e.id !== id);
          next.all = state.historyByScope.all.filter((e) => e.id !== id);
        } else {
          next.current = [item, ...state.historyByScope.current.filter((e) => e.id !== id)];
          next.all = [item, ...state.historyByScope.all.filter((e) => e.id !== id)];
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
      const { models, default_model, default_thinking_level, settings, commands } = msg.payload;
      set({
        models,
        settings: settings ?? null,
        commands: commands ?? [],
        selectedModel: default_model || models[0]?.id || DEFAULT_APP_ID,
        selectedThinkingLevel: default_thinking_level ?? null,
        fetchedScopes: new Set<HistoryScope>(['current']),
        latestEpoch: zeroEpochs(),
      });
    },
    commands_data: (msg) => {
      set({ commands: msg.payload.commands });
    },
    models_data: (msg) => {
      set({ models: msg.payload.models });
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
      if (msg.payload.requestId === get().searchRequestId) {
        set({ searchResults: msg.payload.paths });
      }
    },
  };

  return {
    activeTask: null,
    isRunning: false,
    isCompacting: false,
    view: 'chat',
    inputValue: '',
    textareaRef: null,
    models: [],
    settings: null,
    commands: [],
    selectedModel: DEFAULT_APP_ID,
    selectedThinkingLevel: null,
    scope: 'current',
    historyByScope: emptyHistoryByScope(),
    searchResults: [],
    openedSettingsFromHistory: false,
    latestEpoch: zeroEpochs(),
    fetchedScopes: new Set<HistoryScope>(['current']),
    searchRequestId: '',

    send: (message) => vscode?.postMessage(message),

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

    setSelectedModel: (id) => {
      const { models, selectedThinkingLevel } = get();
      const model = models.find((m) => m.id === id);
      if (!model) return;
      const levels = model.thinkingLevels ?? [];
      const level = selectedThinkingLevel && levels.includes(selectedThinkingLevel) ? selectedThinkingLevel : defaultThinkingLevel(levels);
      set({ selectedModel: id, selectedThinkingLevel: level });
      get().send({ type: 'set_model', model: { id: model.id, provider: model.provider }, thinkingLevel: level ?? undefined });
    },

    setSelectedThinkingLevel: (level) => {
      set({ selectedThinkingLevel: level });
      const { selectedModel, models } = get();
      const provider = models.find((m) => m.id === selectedModel)?.provider ?? '';
      get().send({ type: 'set_model', model: { id: selectedModel, provider }, thinkingLevel: level ?? undefined });
    },

    syncSelectedThinkingLevel: (level) => set({ selectedThinkingLevel: level }),

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
      const handler = messageHandlers[msg.type] as ExtensionMessageHandler<typeof msg.type>;
      if (!handler) {
        logger.warn(`Unhandled webview message type: ${msg.type}`, msg);
        return;
      }
      handler(msg);
    },

    setActiveTask: (value) =>
      set((state) => ({
        activeTask: typeof value === 'function' ? (value as (prev: ActiveTaskState | null) => ActiveTaskState | null)(state.activeTask) : value,
      })),

    setIsRunning: (value) => set({ isRunning: value }),

    setView: (value) => set({ view: value }),

    setInputValue: (value) => set({ inputValue: value }),

    setTextareaRef: (ref) => set({ textareaRef: ref }),

    appendToInput: (text) => {
      const textarea = get().textareaRef?.current;
      if (!textarea) {
        set((state) => ({ inputValue: state.inputValue ? `${state.inputValue}\n${text}` : text }));
        return;
      }
      const caret = textarea.selectionStart;
      set((state) => ({ inputValue: `${state.inputValue.slice(0, caret)}${text}${state.inputValue.slice(caret)}` }));
      const nextCaret = caret + text.length;
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      }, 0);
    },

    setScope: (scope) => set({ scope }),
  };
});

export const selectPendingQuestion = (state: ChatState): ChatMessage | undefined => findPendingQuestion(state.activeTask?.messages ?? []);

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    useChatStore.getState().applyMessage(event.data as ExtensionToWebviewMessage);
  });
}

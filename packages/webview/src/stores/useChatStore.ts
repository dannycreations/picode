import { create } from 'zustand';

import { DEFAULT_APP_ID } from '@pi-code/shared/core/constants';
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

// Webview-side coordination that is not UI state and must not trigger renders.
let latestEpoch: Record<HistoryScope, number> = zeroEpochs();
let fetchedScopes: Set<HistoryScope> = new Set<HistoryScope>(['current']);
let searchRequestId = '';

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

  readonly send: (message: WebviewToExtensionMessage) => void;
  readonly compact: () => void;
  readonly setSelectedModel: (id: string) => void;
  readonly setSelectedThinkingLevel: (level: ModelThinkingLevel | null) => void;
  readonly getHistory: (scope: HistoryScope) => void;
  readonly deleteSessions: (paths: string[]) => void;
  readonly applyMessage: (msg: ExtensionToWebviewMessage) => void;
  readonly setActiveTask: (value: ActiveTaskState | null | ((prev: ActiveTaskState | null) => ActiveTaskState | null)) => void;
  readonly setIsRunning: (value: boolean) => void;
  readonly setIsCompacting: (value: boolean) => void;
  readonly setView: (view: ChatState['view']) => void;
  readonly setInputValue: (value: string) => void;
  readonly setTextareaRef: (ref: RefObject<HTMLTextAreaElement | null> | null) => void;
  readonly appendToInput: (text: string) => void;
  readonly setModels: (models: ModelItem[]) => void;
  readonly setSettings: (settings: AppSettings | null) => void;
  readonly setCommands: (commands: CommandItem[]) => void;
  readonly setSelectedThinkingLevelState: (level: ModelThinkingLevel | null) => void;
  readonly setScope: (scope: HistoryScope) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
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

  getHistory: (scope) => {
    if (fetchedScopes.has(scope)) return;
    fetchedScopes.add(scope);
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
    switch (msg.type) {
      case 'session_loaded':
        set({ activeTask: msg.payload, isRunning: false, isCompacting: false, view: 'chat' });
        break;

      case 'compaction_start':
        set({ isCompacting: true });
        break;

      case 'compaction_end':
        set((state) => ({
          isCompacting: false,
          activeTask: state.activeTask ? { ...state.activeTask, ...msg.payload } : state.activeTask,
        }));
        break;

      case 'reply_queue_data':
        set((state) => ({
          activeTask: state.activeTask
            ? { ...state.activeTask, messages: [...state.activeTask.messages.filter((m) => m.sender !== 'queue'), ...msg.payload.queue] }
            : state.activeTask,
        }));
        break;

      case 'reply_queue_delivered':
        set((state) => ({
          activeTask: state.activeTask
            ? { ...state.activeTask, messages: deliverQueuedReplies(state.activeTask.messages, msg.payload.messages) }
            : state.activeTask,
        }));
        break;

      case 'agent_start': {
        const { path, stats } = msg.payload;
        set((state) => ({
          isRunning: true,
          activeTask: state.activeTask ? { ...state.activeTask, path: path ?? state.activeTask.path, ...stats } : state.activeTask,
        }));
        break;
      }

      case 'message_start': {
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
        break;
      }

      case 'api_request_start': {
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
        break;
      }

      case 'api_request_end': {
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
        break;
      }

      case 'message_end': {
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
        break;
      }

      case 'stream_delta': {
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
        break;
      }

      case 'tool_approval_request': {
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
        break;
      }

      case 'tool_execution_start': {
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
        break;
      }

      case 'tool_execution_update': {
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
        break;
      }

      case 'tool_execution_end': {
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
        break;
      }

      case 'agent_error': {
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
        break;
      }

      case 'agent_settled':
        set((state) => ({
          isRunning: false,
          isCompacting: false,
          activeTask: state.activeTask
            ? { ...state.activeTask, messages: settlePendingTurns(state.activeTask.messages), ...msg.payload }
            : state.activeTask,
        }));
        break;

      case 'archive_result': {
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
          return { historyByScope: next, activeTask };
        });
        fetchedScopes.delete('archives');
        fetchedScopes.delete('all');
        break;
      }

      case 'show_settings':
        set((state) => ({ view: 'settings', openedSettingsFromHistory: state.view === 'history' }));
        break;

      case 'set_chat_input':
        get().appendToInput(msg.payload.text);
        break;

      case 'init_data': {
        const { models, default_model, default_thinking_level, settings, commands } = msg.payload;
        set({
          models,
          settings: settings ?? null,
          commands: commands ?? [],
          selectedModel: default_model || models[0]?.id || DEFAULT_APP_ID,
          selectedThinkingLevel: default_thinking_level ?? null,
        });
        fetchedScopes = new Set<HistoryScope>(['current']);
        latestEpoch = zeroEpochs();
        break;
      }

      case 'commands_data':
        set({ commands: msg.payload.commands });
        break;

      case 'models_data':
        set({ models: msg.payload.models });
        break;

      case 'settings_data':
        set({ settings: msg.payload.settings });
        break;

      case 'history_data': {
        const { scope, epoch, items } = msg.payload;
        const prevEpoch = latestEpoch[scope];
        if (epoch < prevEpoch) break;
        const isNewRefresh = epoch > prevEpoch;
        latestEpoch = { ...latestEpoch, [scope]: epoch };
        set((state) => ({
          historyByScope: {
            ...state.historyByScope,
            [scope]: isNewRefresh ? items : [...state.historyByScope[scope], ...items],
          },
        }));
        break;
      }

      case 'search_results':
        if (msg.payload.requestId === searchRequestId) {
          set({ searchResults: msg.payload.paths });
        }
        break;

      default:
        throw new Error(`Unhandled message type: ${JSON.stringify(msg)}`);
    }
  },

  setActiveTask: (value) =>
    set((state) => ({
      activeTask: typeof value === 'function' ? (value as (prev: ActiveTaskState | null) => ActiveTaskState | null)(state.activeTask) : value,
    })),

  setIsRunning: (value) => set({ isRunning: value }),

  setIsCompacting: (value) => set({ isCompacting: value }),

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

  setModels: (models) => set({ models }),

  setSettings: (settings) => set({ settings }),

  setCommands: (commands) => set({ commands }),

  setSelectedThinkingLevelState: (level) => set({ selectedThinkingLevel: level }),

  setScope: (scope) => set({ scope }),
}));

export const selectPendingQuestion = (state: ChatState): ChatMessage | undefined => findPendingQuestion(state.activeTask?.messages ?? []);

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    useChatStore.getState().applyMessage(event.data as ExtensionToWebviewMessage);
  });
}

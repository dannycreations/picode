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
  readonly isAgentRunning: boolean;
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

  readonly init: () => void;
  readonly loadSession: (id: string, path: string, title: string) => void;
  readonly exportSession: (path: string, id: string) => void;
  readonly viewRawTask: (path?: string) => void;
  readonly archiveSession: (path: string, id: string, title: string) => void;
  readonly continueTask: (path?: string) => void;
  readonly sendMessage: (text: string, path: string | undefined, images: string[]) => void;
  readonly addToReplyQueue: (text: string, images?: string[]) => void;
  readonly questionResponse: (questionId: string, text: string) => void;
  readonly toolResponse: (approvalId: string, approved: boolean) => void;
  readonly cancelTask: () => void;
  readonly reloadCatalog: () => void;
  readonly updateCatalog: () => void;
  readonly compact: () => void;
  readonly setSelectedModel: (id: string) => void;
  readonly setSelectedThinkingLevel: (level: ModelThinkingLevel | null) => void;
  readonly getHistory: (scope: HistoryScope) => void;
  readonly deleteSessions: (paths: string[]) => void;
  readonly updateSettings: (settings: Partial<AppSettings>) => void;
  readonly searchFiles: (query: string, requestId: string) => void;
  readonly openImage: (dataUrl: string) => void;
  readonly insertMentions: (paths: string[]) => void;
  readonly saveImage: (dataUrl: string, filename: string) => void;
  readonly openFile: (text: string, values?: { line?: number; diff?: boolean }) => void;
  readonly editReplyQueue: (id: string, text: string) => void;
  readonly removeFromReplyQueue: (id: string) => void;
  readonly applyMessage: (msg: ExtensionToWebviewMessage) => void;
  readonly setActiveTask: (value: ActiveTaskState | null | ((prev: ActiveTaskState | null) => ActiveTaskState | null)) => void;
  readonly setIsAgentRunning: (value: boolean) => void;
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
  isAgentRunning: false,
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

  init: () => vscode?.postMessage({ type: 'init' }),

  loadSession: (id, path, title) => vscode?.postMessage({ type: 'load_session', id, path, title }),

  exportSession: (path, id) => {
    if (!path) return;
    vscode?.postMessage({ type: 'export_session', path, id });
  },

  viewRawTask: (path) => {
    if (path) vscode?.postMessage({ type: 'view_raw_task', path });
  },

  archiveSession: (path, id, title) => vscode?.postMessage({ type: 'archive_session', path, id, title }),

  continueTask: (path) => vscode?.postMessage({ type: 'continue_task', path }),

  sendMessage: (text, path, images) => vscode?.postMessage({ type: 'send_message', text, path, images: images.length > 0 ? images : undefined }),

  addToReplyQueue: (text, images) =>
    vscode?.postMessage({ type: 'add_to_reply_queue', text, images: images && images.length > 0 ? images : undefined }),

  questionResponse: (questionId, text) => vscode?.postMessage({ type: 'question_response', question_id: questionId, text }),

  toolResponse: (approvalId, approved) => vscode?.postMessage({ type: 'tool_response', approval_id: approvalId, approved }),

  cancelTask: () => vscode?.postMessage({ type: 'cancel_task' }),

  reloadCatalog: () => vscode?.postMessage({ type: 'builtin_command', command: 'reload' }),

  updateCatalog: () => vscode?.postMessage({ type: 'builtin_command', command: 'update' }),

  compact: () => {
    const { activeTask } = get();
    vscode?.postMessage({
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
    vscode?.postMessage({ type: 'set_model', model: { id: model.id, provider: model.provider }, thinkingLevel: level ?? undefined });
  },

  setSelectedThinkingLevel: (level) => {
    set({ selectedThinkingLevel: level });
    const { selectedModel, models } = get();
    const provider = models.find((m) => m.id === selectedModel)?.provider ?? '';
    vscode?.postMessage({ type: 'set_model', model: { id: selectedModel, provider }, thinkingLevel: level ?? undefined });
  },

  getHistory: (scope) => {
    if (fetchedScopes.has(scope)) return;
    fetchedScopes.add(scope);
    vscode?.postMessage({ type: 'get_history', scope });
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
    vscode?.postMessage({ type: 'delete_sessions', paths });
  },

  updateSettings: (settings) => vscode?.postMessage({ type: 'update_settings', settings }),

  searchFiles: (query, requestId) => {
    searchRequestId = requestId;
    set({ searchResults: [] });
    vscode?.postMessage({ type: 'search_files', query, requestId });
  },

  openImage: (dataUrl) => vscode?.postMessage({ type: 'open_image', dataUrl }),

  insertMentions: (paths) => vscode?.postMessage({ type: 'insert_mentions', paths }),

  saveImage: (dataUrl, filename) => vscode?.postMessage({ type: 'save_image', dataUrl, filename }),

  openFile: (text, values) => vscode?.postMessage({ type: 'open_file', text, values }),

  editReplyQueue: (id, text) => vscode?.postMessage({ type: 'edit_reply_queue', id, text }),

  removeFromReplyQueue: (id) => vscode?.postMessage({ type: 'remove_from_reply_queue', id }),

  applyMessage: (msg) => {
    switch (msg.type) {
      case 'session_loaded':
        set({ activeTask: msg.payload, isAgentRunning: false, isCompacting: false, view: 'chat' });
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
          isAgentRunning: true,
          activeTask: state.activeTask ? { ...state.activeTask, path: path ?? state.activeTask.path, ...stats } : state.activeTask,
        }));
        break;
      }

      case 'message_start': {
        const { timestamp } = msg.payload;
        set((state) => ({
          isAgentRunning: true,
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
          isAgentRunning: true,
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
          isAgentRunning: true,
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
          if (!state.activeTask) return { isAgentRunning: false };
          return {
            isAgentRunning: false,
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
          isAgentRunning: false,
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
    }
  },

  setActiveTask: (value) =>
    set((state) => ({
      activeTask: typeof value === 'function' ? (value as (prev: ActiveTaskState | null) => ActiveTaskState | null)(state.activeTask) : value,
    })),

  setIsAgentRunning: (value) => set({ isAgentRunning: value }),

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

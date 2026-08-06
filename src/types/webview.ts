import type { ValueOf } from 'es-toolkit/types';
import type { AppSettings } from '@extension/core/settings';
import type { TodoItem } from '@extension/structures/chat-session/todo';

export interface ActiveTaskState {
  readonly id: string;
  readonly title: string;
  readonly messages: ChatMessage[];
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheWrites?: number;
  readonly cacheReads?: number;
  readonly totalCost: number;
  readonly contextTokens: number;
  readonly contextLimit: number;
  readonly path?: string;
}

export type ToolName =
  'attempt_completion' | 'ask_question' | 'write_file' | 'execute_command' | 'read_file' | 'update_todo' | 'edit_file' | 'delete_file';

export interface ChatMessage {
  readonly id: string;
  readonly sender: 'user' | 'assistant' | 'tool' | 'error' | 'checkpoint' | 'info' | 'api_request';
  readonly text: string;
  readonly ts: number;
  readonly toolName?: ToolName;
  readonly toolArgs?: string;
  readonly toolStatus?: 'approval' | 'approved' | 'running' | 'completed' | 'denied';
  readonly reasoning?: string;
  readonly cost?: number;
  readonly checkpointHash?: string;
  readonly diff?: string;
  readonly todos?: TodoItem[];
  readonly errorMessage?: string;
  readonly images?: string[];
}

export interface SettingsData {
  readonly key: keyof AppSettings;
  readonly value: ValueOf<AppSettings>;
}

export interface HistoryItem {
  readonly id: string;
  readonly path: string;
  readonly task: string;
  readonly ts: number;
}

export interface ModelItem {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
}

export interface StatsData {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheWrites?: number;
  readonly cacheReads?: number;
  readonly totalCost: number;
  readonly contextTokens: number;
  readonly contextLimit: number;
}

export type WebviewToExtensionMessage =
  | { type: 'init' }
  | { type: 'get_history'; scope: 'current' | 'all' }
  | { type: 'load_session'; id: string; path: string; title: string }
  | { type: 'delete_sessions'; paths: string[]; scope: 'current' | 'all' }
  | { type: 'start_new_task'; text: string; model_id: string; model_provider?: string; images?: string[] }
  | { type: 'send_message'; text: string; path?: string; model_id?: string; model_provider?: string; images?: string[] }
  | { type: 'continue_task'; path?: string; model_id?: string; model_provider?: string }
  | { type: 'approve_tool'; approval_id: string }
  | { type: 'deny_tool'; approval_id: string }
  | { type: 'question_response'; question_id: string; text: string }
  | { type: 'view_raw_task'; path?: string }
  | { type: 'export_session'; path: string; id: string }
  | { type: 'open_file'; text: string; values?: { line: number } }
  | { type: 'open_image'; dataUrl: string }
  | { type: 'close_task' }
  | { type: 'cancel_task' }
  | { type: 'compact'; id: string; path?: string; title: string }
  | { type: 'get_settings' }
  | ({ type: 'update_setting' } & SettingsData);

export type ExtensionToWebviewMessage =
  | { type: 'init_data'; payload: { models: ModelItem[]; history: HistoryItem[]; default_model?: string } }
  | { type: 'history_data'; payload: { history: HistoryItem[] } }
  | { type: 'settings_data'; payload: { settings: AppSettings } }
  | { type: 'session_loaded'; payload: ActiveTaskState }
  | { type: 'agent_start'; payload: { path?: string; stats?: StatsData } }
  | { type: 'message_start'; payload: { role: string; timestamp?: number } }
  | { type: 'text_delta'; payload: { delta: string } }
  | { type: 'thinking_delta'; payload: { delta: string } }
  | { type: 'message_end'; payload?: { role: string; cost?: number; stats?: StatsData } }
  | { type: 'api_request_start'; payload: { id: string; timestamp: number } }
  | { type: 'api_request_end'; payload: { id: string; cost?: number; error?: string; stats?: StatsData } }
  | { type: 'tool_approval_request'; payload: { id: string; tool_name: ToolName; arguments: string } }
  | { type: 'tool_execution_start'; payload: { id: string; tool_name?: ToolName; arguments?: string } }
  | { type: 'tool_execution_end'; payload: { id: string; result?: string; todos?: TodoItem[]; is_error?: boolean } }
  | { type: 'agent_error'; payload: { message: string } }
  | { type: 'agent_settled'; payload?: StatsData }
  | { type: 'compaction_end'; payload: StatsData }
  | { type: 'show_settings' }
  | { type: 'set_chat_input'; payload: { text: string } };

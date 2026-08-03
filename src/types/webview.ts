import type { AppSettings } from '@extension/core/settings';

export type ToolName =
  | 'attempt_completion'
  | 'ask_question'
  | 'write_file'
  | 'write_to_file'
  | 'execute_command'
  | 'read_file'
  | 'update_todo'
  | 'edit_file'
  | 'delete_file';

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
  readonly errorMessage?: string;
  readonly images?: string[];
}

export interface HistoryItem {
  readonly id: string;
  readonly path: string;
  readonly task: string;
  readonly ts: number;
}

export type WebviewToExtensionMessage =
  | { type: 'init' }
  | { type: 'get_history'; scope: 'current' | 'all' }
  | { type: 'load_session'; id: string; path: string; title: string }
  | { type: 'delete_sessions'; paths: string[]; scope: 'current' | 'all' }
  | { type: 'start_new_task'; text: string; model_id: string; images?: string[] }
  | { type: 'send_message'; text: string; path?: string; images?: string[] }
  | { type: 'continue_task'; path?: string }
  | { type: 'approve_tool'; approval_id: string }
  | { type: 'deny_tool'; approval_id: string }
  | { type: 'view_raw_task'; path?: string }
  | { type: 'export_session'; path: string; id: string }
  | { type: 'open_file'; text: string; values?: { line: number } }
  | { type: 'open_image'; dataUrl: string }
  | { type: 'close_task' }
  | { type: 'cancel_task' }
  | { type: 'get_settings' }
  | { type: 'update_setting'; key: keyof AppSettings; value: unknown };

export type ExtensionToWebviewMessage =
  | { type: 'init_data'; payload: { models: { id: string; name: string }[]; history: HistoryItem[]; default_model?: string } }
  | { type: 'history_data'; payload: { history: HistoryItem[] } }
  | { type: 'settings_data'; payload: { settings: AppSettings } }
  | {
      type: 'session_loaded';
      payload: {
        id: string;
        title: string;
        messages: ChatMessage[];
        path?: string;
        tokensIn?: number;
        tokensOut?: number;
        cacheWrites?: number;
        cacheReads?: number;
        totalCost?: number;
        contextTokens?: number;
        contextLimit?: number;
      };
    }
  | {
      type: 'stats_update';
      payload: {
        tokensIn: number;
        tokensOut: number;
        cacheWrites?: number;
        cacheReads?: number;
        totalCost: number;
        contextTokens: number;
        contextLimit: number;
      };
    }
  | { type: 'agent_start'; payload: { path?: string } }
  | { type: 'message_start'; payload: { role: string; timestamp?: number } }
  | { type: 'text_delta'; payload: { delta: string } }
  | { type: 'thinking_delta'; payload: { delta: string } }
  | { type: 'message_end'; payload?: { role: string; cost?: number } }
  | { type: 'api_request_start'; payload: { id: string; timestamp: number } }
  | { type: 'api_request_end'; payload: { id: string; cost?: number; error?: string } }
  | { type: 'tool_approval_request'; payload: { id: string; tool_name: ToolName; arguments: string } }
  | { type: 'tool_execution_start'; payload: { id: string; tool_name?: ToolName; arguments?: string } }
  | { type: 'tool_execution_end'; payload: { id: string; result?: string; is_error?: boolean } }
  | { type: 'agent_error'; payload: { message: string } }
  | { type: 'agent_settled' }
  | { type: 'show_settings' }
  | { type: 'set_chat_input'; payload: { text: string } };

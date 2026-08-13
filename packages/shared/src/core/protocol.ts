import type { HISTORY_SCOPES } from '@pi-code/shared/core/constants';
import type { AppSettings } from '@pi-code/shared/core/settings';
import type { ActiveTaskState, ModelThinkingLevel, ReadFileSection, StatsData, ToolName } from '@pi-code/shared/core/types';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

export interface HistoryItem {
  readonly id: string;
  readonly path: string;
  readonly task: string;
  readonly ts: number;
}

export interface QueueMessage {
  readonly id: string;
  readonly text: string;
  readonly images?: string[];
  readonly ts: number;
}

export interface ModelItem {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly thinkingLevels?: readonly ModelThinkingLevel[];
}

export type ModelSelection = Pick<ModelItem, 'id' | 'provider'>;

export interface CommandItem {
  readonly name: string;
  readonly source: 'builtin' | 'skill' | 'prompt';
  readonly description?: string;
  readonly detail?: string;
}

export type HistoryScope = (typeof HISTORY_SCOPES)[number];

export type WebviewToExtensionMessage =
  | { type: 'init' }
  | { type: 'get_history'; scope: HistoryScope }
  | { type: 'load_session'; id: string; path: string; title: string }
  | { type: 'delete_sessions'; paths: string[] }
  | { type: 'send_message'; text: string; path?: string; model?: ModelSelection; images?: string[] }
  | { type: 'continue_task'; path?: string; model?: ModelSelection }
  | { type: 'tool_response'; approval_id: string; approved: boolean }
  | { type: 'question_response'; question_id: string; text: string }
  | { type: 'view_raw_task'; path?: string }
  | { type: 'export_session'; path: string; id: string }
  | { type: 'open_file'; text: string; values?: { line?: number; diff?: boolean } }
  | { type: 'open_image'; dataUrl: string }
  | { type: 'save_image'; dataUrl: string; filename: string }
  | { type: 'close_task' }
  | { type: 'cancel_task' }
  | { type: 'compact'; id: string; path?: string; title: string }
  | { type: 'set_thinking_level'; level: ModelThinkingLevel }
  | { type: 'reload' }
  | { type: 'update_settings'; settings: Partial<AppSettings> }
  | { type: 'add_to_reply_queue'; text: string; images?: string[] }
  | { type: 'edit_reply_queue'; id: string; text: string }
  | { type: 'remove_from_reply_queue'; id: string };

export type ExtensionToWebviewMessage =
  | {
      type: 'init_data';
      payload: {
        models: ModelItem[];
        history: HistoryItem[];
        default_model?: string;
        default_thinking_level?: ModelThinkingLevel;
        settings: AppSettings;
        commands: CommandItem[];
      };
    }
  | { type: 'history_data'; payload: { history: HistoryItem[]; scope: HistoryScope } }
  | { type: 'commands_data'; payload: { commands: CommandItem[] } }
  | { type: 'settings_data'; payload: { settings: AppSettings } }
  | { type: 'session_loaded'; payload: ActiveTaskState }
  | { type: 'agent_start'; payload: { path?: string; stats?: StatsData } }
  | { type: 'message_start'; payload: { timestamp: number } }
  | { type: 'message_end'; payload: { cost?: number; stats?: StatsData } }
  | { type: 'api_request_start'; payload: { id: string; timestamp: number } }
  | { type: 'api_request_end'; payload: { id: string; cost?: number; error?: string; stats?: StatsData } }
  | { type: 'tool_approval_request'; payload: { id: string; tool_name: ToolName; arguments: string; subagent?: string } }
  | { type: 'tool_execution_start'; payload: { id: string; tool_name: ToolName; arguments: string } }
  | { type: 'tool_execution_update'; payload: { id: string; result: string } }
  | {
      type: 'tool_execution_end';
      payload: { id: string; result?: string; todos?: TodoItem[]; is_error?: boolean; files?: ReadonlyArray<ReadFileSection> };
    }
  | { type: 'agent_error'; payload: { message: string } }
  | { type: 'agent_settled'; payload?: StatsData }
  | { type: 'compaction_end'; payload: StatsData }
  | { type: 'info'; payload: { text: string } }
  | { type: 'show_settings' }
  | { type: 'set_chat_input'; payload: { text: string } }
  | { type: 'reply_queue_data'; payload: { queue: QueueMessage[] } }
  | { type: 'stream_delta'; payload: { text?: string; thinking?: string } };

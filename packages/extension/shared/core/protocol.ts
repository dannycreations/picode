import type { AppSettings } from '@pi-code/shared/core/settings';
import type {
  ActiveTaskState,
  Attachment,
  ChatMessage,
  ModelThinkingLevel,
  ReadFileSection,
  StatsData,
  ToolArguments,
  ToolName,
} from '@pi-code/shared/core/types';
import type { BuiltinCommandName } from '@pi-code/shared/utilities/commands';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

export const HISTORY_SCOPES = ['current', 'all', 'archives'] as const;

export type HistoryScope = (typeof HISTORY_SCOPES)[number];

export interface HistoryItem {
  readonly id: string;
  readonly path: string;
  readonly task: string;
  readonly timestamp: number;
}

export interface ModelItem {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly contextWindow?: number;
  readonly supportsImages?: boolean;
  readonly thinkingLevels?: readonly ModelThinkingLevel[];
}

export type ModelSelection = Pick<ModelItem, 'id' | 'provider'>;

// Providers never contain slashes while model ids may, so the provider is
// everything before the first slash.
export function formatModelSelection(selection: ModelSelection): string {
  return `${selection.provider}/${selection.id}`;
}

export function parseModelSelection(value: string): ModelSelection | undefined {
  const separator = value.indexOf('/');
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return { provider: value.slice(0, separator), id: value.slice(separator + 1) };
}

export interface CommandItem {
  readonly name: string;
  readonly source: 'builtin' | 'skill' | 'prompt';
  readonly description?: string;
  readonly detail?: string;
}

export interface CommitItem {
  readonly hash: string;
  readonly shortHash: string;
  readonly subject: string;
  readonly author?: string;
  readonly date?: string;
}

export interface WorkspaceFolderItem {
  readonly name: string;
  readonly path: string;
}

export type WebviewToExtensionMessage =
  | { type: 'init' }
  | { type: 'get_history'; scope: HistoryScope }
  | { type: 'load_session'; id: string; path: string; title: string }
  | { type: 'delete_sessions'; paths: string[] }
  | { type: 'send_message'; text: string; path?: string; attachments?: Attachment[] }
  | { type: 'search_files'; query: string }
  | { type: 'search_commits'; query: string }
  | { type: 'continue_task'; path?: string }
  | { type: 'tool_response'; approval_id: string; approved: boolean }
  | { type: 'question_response'; question_id: string; text: string; attachments?: Attachment[] }
  | { type: 'view_raw_task'; path?: string }
  | { type: 'export_session'; path: string; id: string }
  | { type: 'archive_session'; path: string; id: string; title: string }
  | { type: 'open_file'; text: string; values?: { line?: number; diff?: boolean } }
  | { type: 'open_attachment'; attachment: Attachment }
  | { type: 'save_image'; dataUrl: string; filename: string }
  | { type: 'cancel_task' }
  | { type: 'builtin_command'; command: Exclude<BuiltinCommandName, 'compact'> }
  | { type: 'builtin_command'; command: Extract<BuiltinCommandName, 'compact'>; id: string; path?: string; title: string }
  | { type: 'set_model'; model: ModelSelection; thinkingLevel?: ModelThinkingLevel }
  | { type: 'update_settings'; settings: Partial<AppSettings> }
  | { type: 'add_to_reply_queue'; text: string; attachments?: Attachment[] }
  | { type: 'edit_reply_queue'; id: string; text: string }
  | { type: 'remove_from_reply_queue'; id: string }
  | { type: 'insert_mentions'; paths: string[] }
  | { type: 'select_workspace'; path: string };

export type ExtensionToWebviewMessage =
  | {
      type: 'init_data';
      payload: {
        models: ModelItem[];
        default_model?: string;
        default_thinking_level?: ModelThinkingLevel;
        settings: AppSettings;
        commands: CommandItem[];
      };
    }
  | { type: 'history_data'; payload: { scope: HistoryScope; epoch: number; items: HistoryItem[] } }
  | { type: 'commands_data'; payload: { commands: CommandItem[] } }
  | { type: 'models_data'; payload: { models: ModelItem[] } }
  | { type: 'settings_data'; payload: { settings: AppSettings } }
  | { type: 'session_loaded'; payload: ActiveTaskState }
  | { type: 'archive_result'; payload: { path: string; archived: boolean; id: string; title: string } }
  | { type: 'agent_start'; payload: { path?: string; stats?: StatsData } }
  | { type: 'message_start'; payload: { timestamp: number } }
  | { type: 'message_end'; payload: { cost?: number; stats?: StatsData } }
  | { type: 'api_request_start'; payload: { id: string; timestamp: number } }
  | { type: 'api_request_end'; payload: { id: string; cost?: number; error?: string; stats?: StatsData } }
  | {
      type: 'tool_approval_request';
      payload: { id: string; tool_name: ToolName; arguments: ToolArguments; subagent?: string; toolCallId?: string };
    }
  | { type: 'tool_execution_start'; payload: { id: string; tool_name: ToolName; arguments: ToolArguments; subagent?: string } }
  | { type: 'tool_execution_update'; payload: { id: string; result: string; subagent?: string; subtitle?: string } }
  | {
      type: 'tool_execution_end';
      payload: {
        id: string;
        result?: string;
        todos?: TodoItem[];
        is_error?: boolean;
        files?: ReadonlyArray<ReadFileSection>;
        subagent?: string;
        subtitle?: string;
      };
    }
  | { type: 'agent_error'; payload: { message: string } }
  | { type: 'agent_settled'; payload?: StatsData }
  | { type: 'compaction_start' }
  | { type: 'compaction_end'; payload?: StatsData }
  | { type: 'show_settings' }
  | { type: 'set_chat_input'; payload: { text: string } }
  | { type: 'search_results'; payload: { query: string; paths: string[] } }
  | { type: 'commit_results'; payload: { query: string; commits: CommitItem[] } }
  | { type: 'reply_queue_data'; payload: { queue: ChatMessage[] } }
  | { type: 'reply_queue_delivered'; payload: { messages: ChatMessage[] } }
  | { type: 'stream_delta'; payload: { text?: string; thinking?: string } }
  | { type: 'workspace_data'; payload: { folders: WorkspaceFolderItem[]; active: string } };

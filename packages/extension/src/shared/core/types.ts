import type { TodoItem } from '@pi-code/shared/utilities/todo';

export type { ModelThinkingLevel } from '@earendil-works/pi-ai';

export interface ActiveTaskState extends StatsData {
  readonly id: string;
  readonly title: string;
  readonly messages: ChatMessage[];
  readonly path?: string;
  readonly isArchived?: boolean;
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

export type ToolName =
  'ask_question' | 'delete_file' | 'edit_file' | 'execute_command' | 'mcp' | 'read_file' | 'spawn_subagent' | 'update_todo' | 'write_file';

export type ToolStatus = 'approval' | 'completed' | 'denied' | 'running';

export type ToolArguments =
  // ask_question
  | { question: string; follow_up: Array<{ text: string }> }
  // delete_file
  | { path: string }
  // edit_file
  | { file_path: string; old_string: string; new_string: string; expected?: number }
  // execute_command
  | { command: string; cwd?: string | null; timeout?: number }
  // read_file
  | { files: Array<{ path: string; line_ranges?: Array<[number, number]> }> }
  // spawn_subagent
  | { agent: string; description: string; task: string }
  // update_todo
  | { todos: Array<TodoItem> }
  // write_file
  | { path: string; content: string }
  // mcp
  | { server?: string; tool?: string; arguments?: Record<string, unknown> };

export interface ReadFileSection {
  readonly path: string;
  readonly content: string;
}

export interface ToolResultDetails {
  readonly diff?: string;
  readonly todos?: TodoItem[];
  readonly files?: ReadonlyArray<ReadFileSection>;
  readonly duration?: number;
  readonly subtitle?: string;
}

export interface ImageAttachment {
  readonly kind: 'image';
  readonly dataUrl: string;
}

export interface TextAttachment {
  readonly kind: 'text';
  readonly content: string;
  readonly language?: string;
}

export type Attachment = ImageAttachment | TextAttachment;

export interface ToolSection {
  readonly id?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly content?: string;
  readonly language?: string;
  readonly openPath?: string;
  readonly diffLine?: number;
  readonly ts?: number;
  readonly duration?: number;
  readonly status?: string;
  readonly approvalMessage?: ChatMessage;
}

interface ChatMessageBase {
  readonly id: string;
  readonly text: string;
  readonly ts: number;
}

export interface ApiRequestChatMessage extends ChatMessageBase {
  readonly sender: 'api_request';
  readonly toolStatus?: ToolStatus;
  readonly errorMessage?: string;
  readonly cost?: number;
}

export interface AssistantChatMessage extends ChatMessageBase {
  readonly sender: 'assistant';
  readonly toolStatus?: ToolStatus;
  readonly reasoning?: string;
  readonly cost?: number;
}

interface CheckpointChatMessage extends ChatMessageBase {
  readonly sender: 'checkpoint';
}

interface ErrorChatMessage extends ChatMessageBase {
  readonly sender: 'error';
  readonly errorMessage?: string;
}

interface InfoChatMessage extends ChatMessageBase {
  readonly sender: 'info';
}

export interface QueueChatMessage extends ChatMessageBase {
  readonly sender: 'queue';
  readonly attachments?: readonly Attachment[];
}

export interface ToolChatMessage extends ChatMessageBase {
  readonly sender: 'tool';
  readonly toolName?: ToolName;
  readonly toolArgs?: ToolArguments;
  readonly toolStatus?: ToolStatus;
  readonly diff?: string;
  readonly todos?: TodoItem[];
  readonly errorMessage?: string;
  readonly subagent?: string;
  readonly subtitle?: string;
  readonly toolCallId?: string;
  readonly duration?: number;
  readonly pausedAt?: number;
  readonly attachments?: readonly Attachment[];
  readonly files?: ReadonlyArray<ReadFileSection>;
  readonly toolSections?: ReadonlyArray<ToolSection>;
}

interface UserChatMessage extends ChatMessageBase {
  readonly sender: 'user';
  readonly attachments?: readonly Attachment[];
}

export type ChatMessage =
  | ApiRequestChatMessage
  | AssistantChatMessage
  | CheckpointChatMessage
  | ErrorChatMessage
  | InfoChatMessage
  | QueueChatMessage
  | ToolChatMessage
  | UserChatMessage;

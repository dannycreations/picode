import type { THINKING_LEVEL_ORDER } from '@pi-code/shared/core/constants';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

export interface ActiveTaskState extends StatsData {
  readonly id: string;
  readonly title: string;
  readonly messages: ChatMessage[];
  readonly path?: string;
  readonly isArchived?: boolean;
}

export type ToolName =
  'ask_question' | 'delete_file' | 'edit_file' | 'execute_command' | 'read_file' | 'spawn_subagent' | 'update_todo' | 'write_file';

export type ModelThinkingLevel = (typeof THINKING_LEVEL_ORDER)[number];

export interface ReadFileSection {
  readonly path: string;
  readonly content: string;
}

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

export interface ChatMessage {
  readonly id: string;
  readonly sender: 'api_request' | 'assistant' | 'checkpoint' | 'error' | 'info' | 'queue' | 'tool' | 'user';
  readonly text: string;
  readonly ts: number;
  readonly toolName?: ToolName;
  readonly toolArgs?: string;
  readonly toolStatus?: 'approval' | 'completed' | 'denied' | 'running';
  readonly reasoning?: string;
  readonly cost?: number;
  readonly diff?: string;
  readonly todos?: TodoItem[];
  readonly errorMessage?: string;
  readonly images?: string[];
  readonly subagent?: string;
  readonly parentToolCallId?: string;
  readonly duration?: number;
  readonly files?: ReadonlyArray<ReadFileSection>;
  readonly toolSections?: ReadonlyArray<ToolSection>;
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

import type { TodoItem } from '@pi-code/shared/utilities/todo';

export interface ActiveTaskState extends StatsData {
  readonly id: string;
  readonly title: string;
  readonly messages: ChatMessage[];
  readonly path?: string;
}

export type ToolName =
  'ask_question' | 'write_file' | 'execute_command' | 'read_file' | 'update_todo' | 'edit_file' | 'delete_file' | 'spawn_subagent';

export type ModelThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ReadFileSection {
  readonly path: string;
  readonly content: string;
}

export interface ToolSection {
  readonly title: string;
  readonly subtitle?: string;
  readonly content?: string;
  readonly language?: string;
  readonly openPath?: string;
  readonly diffLine?: number;
  readonly ts?: number;
  readonly duration?: number;
  readonly status?: string;
}

export interface ChatMessage {
  readonly id: string;
  readonly sender: 'user' | 'assistant' | 'tool' | 'error' | 'checkpoint' | 'info' | 'api_request' | 'queue';
  readonly text: string;
  readonly ts: number;
  readonly toolName?: ToolName;
  readonly toolArgs?: string;
  readonly toolStatus?: 'approval' | 'running' | 'completed' | 'denied';
  readonly reasoning?: string;
  readonly cost?: number;
  readonly diff?: string;
  readonly todos?: TodoItem[];
  readonly errorMessage?: string;
  readonly images?: string[];
  readonly subagent?: string;
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

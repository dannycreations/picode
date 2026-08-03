import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import type { Uri } from 'vscode';

export interface AgentModel {
  readonly id: string;
  readonly name?: string;
  readonly displayName?: string;
}

export interface AssistantMessageWithUsage {
  readonly role: 'assistant';
  readonly usage?: {
    readonly cost?: {
      readonly total?: number;
    };
  };
}

export interface EnvironmentMessageContent {
  readonly type: 'text' | 'thinking' | 'toolCall';
  readonly text?: string;
  readonly thinking?: string;
}

export interface EnvironmentMessage {
  readonly role: string;
  readonly toolName?: string;
  readonly details?: unknown;
  readonly content?: unknown;
}

export interface AgentToolState {
  readonly name: string;
}

export interface SessionMessageContent {
  readonly type: 'text' | 'thinking' | 'toolCall' | 'image';
  readonly text?: string;
  readonly thinking?: string;
  readonly id?: string;
  readonly name?: string;
  readonly arguments?: unknown;
  readonly mimeType?: string;
  readonly data?: string;
}

export interface SessionMessage {
  readonly role: 'user' | 'assistant' | 'toolResult' | 'bashExecution';
  readonly content?: string | SessionMessageContent[];
  readonly usage?: {
    readonly cost?: {
      readonly total?: number;
    };
  };
  readonly errorMessage?: string;
  readonly toolCallId?: string;
  readonly isError?: boolean;
  readonly details?: {
    readonly diff?: string;
    readonly todos?: string;
  };
  readonly command?: string;
  readonly cancelled?: boolean;
  readonly output?: string;
}

export interface SessionEntryMessage {
  readonly id: string;
  readonly type: 'message';
  readonly timestamp: string;
  readonly message: SessionMessage;
}

export interface SessionEntryCompaction {
  readonly id: string;
  readonly type: 'compaction';
  readonly timestamp: string;
  readonly summary: string;
}

export interface SessionEntryLabel {
  readonly id: string;
  readonly type: 'label';
  readonly timestamp: string;
  readonly label?: string;
}

export type SessionTreeEntry = SessionEntryMessage | SessionEntryCompaction | SessionEntryLabel;

export interface GitRepository {
  readonly rootUri: Uri;
  readonly inputBox: {
    value: string;
  };
}

export interface GitAPI {
  readonly repositories: readonly GitRepository[];
}

export interface GitExtension {
  getAPI(version: number): GitAPI | undefined;
}

export interface ScmRequest {
  readonly rootUri?: Uri;
}

export interface LlmResponseContent {
  readonly type: 'text' | 'image' | 'toolCall';
  readonly text?: string;
}

export interface CustomToolResult<T = unknown> extends AgentToolResult<T> {
  readonly isError?: boolean;
}

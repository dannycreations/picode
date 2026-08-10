import type { AgentToolResult } from '@earendil-works/pi-coding-agent';

export interface CustomToolResult<T = unknown> extends AgentToolResult<T> {
  readonly isError?: boolean;
}

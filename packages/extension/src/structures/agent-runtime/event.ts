import { uuidv7 } from '@earendil-works/pi-ai';

import { takeSubagentUsage } from '@pi-code/extension/structures/agent-runtime/subagent';
import { DEFAULT_CONTEXT_LIMIT } from '@pi-code/shared/core/constants';
import { logger } from '@pi-code/shared/core/logger';

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AgentToWebviewMessage } from '@pi-code/extension/structures/agent-runtime/webview';
import type { ReadFileSection, StatsData, ToolName } from '@pi-code/shared/core/protocol';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

interface ToolResultPart {
  readonly type: string;
  readonly text?: string;
}

export function toolResultText(result: unknown): string {
  if (typeof result === 'string') return result;

  const content = (result as { content?: readonly ToolResultPart[] } | undefined)?.content;
  const parts = Array.isArray(content) ? content.filter((part) => part.type === 'text' && typeof part.text === 'string') : [];
  if (parts.length === 0) return JSON.stringify(result) ?? '';

  return parts.map((part) => part.text).join('\n');
}

export class EventMapper {
  private apiRequestId: string | null = null;

  public resetTurnState(): void {
    this.apiRequestId = null;
  }

  public mapEvent(event: AgentSessionEvent, session: AgentSession): AgentToWebviewMessage | null {
    switch (event.type) {
      case 'agent_start':
        return {
          type: 'agent_start',
          payload: { path: session.sessionFile, stats: this.createStats(session) ?? undefined },
        };

      case 'turn_start': {
        this.apiRequestId = this.nextApiRequestId();
        return {
          type: 'api_request_start',
          payload: { id: this.apiRequestId, timestamp: Date.now() },
        };
      }

      case 'turn_end': {
        const id = this.apiRequestId || this.nextApiRequestId();
        this.apiRequestId = null;
        const msg = event.message?.role === 'assistant' ? event.message : undefined;
        const isError = msg?.stopReason === 'error';
        return {
          type: 'api_request_end',
          payload: {
            id,
            cost: msg?.usage?.cost?.total,
            error: isError ? msg.errorMessage || 'The API request failed.' : undefined,
            stats: this.createStats(session) ?? undefined,
          },
        };
      }

      case 'message_start':
        if (event.message.role !== 'assistant') {
          return null;
        }
        return {
          type: 'message_start',
          payload: { timestamp: event.message.timestamp },
        };

      case 'message_update': {
        const type = event.assistantMessageEvent.type;
        if (type === 'text_delta' || type === 'thinking_delta') {
          return {
            type,
            payload: { delta: event.assistantMessageEvent.delta },
          };
        }
        return null;
      }

      case 'message_end':
        if (event.message.role !== 'assistant') {
          return null;
        }
        return {
          type: 'message_end',
          payload: {
            cost: event.message.usage?.cost?.total,
            stats: this.createStats(session) ?? undefined,
          },
        };

      case 'tool_execution_start':
        return {
          type: 'tool_execution_start',
          payload: {
            id: event.toolCallId,
            tool_name: event.toolName as ToolName,
            arguments: JSON.stringify(event.args),
          },
        };

      case 'tool_execution_update':
        return {
          type: 'tool_execution_update',
          payload: { id: event.toolCallId, result: toolResultText(event.partialResult) },
        };

      case 'tool_execution_end': {
        const toolResult = event.result as
          | {
              details?: {
                todos?: TodoItem[];
                files?: ReadonlyArray<ReadFileSection>;
              };
            }
          | undefined;
        return {
          type: 'tool_execution_end',
          payload: {
            id: event.toolCallId,
            result: toolResultText(event.result),
            todos: toolResult?.details?.todos,
            files: toolResult?.details?.files,
            is_error: event.isError,
          },
        };
      }

      case 'agent_settled': {
        const stats = this.createStats(session);
        if (!stats) return { type: 'agent_settled' };

        // Sub-agent spend is in-memory only, so it never lands in the session
        // file. Fold this turn's delegated usage into the header stats here,
        // then clear it so the next turn accounts for its own runs.
        const child = takeSubagentUsage(session.sessionId);
        return {
          type: 'agent_settled',
          payload: {
            ...stats,
            tokensIn: stats.tokensIn + child.tokensIn,
            tokensOut: stats.tokensOut + child.tokensOut,
            totalCost: stats.totalCost + child.cost,
          },
        };
      }

      case 'compaction_start':
        return {
          type: 'agent_start',
          payload: { path: session.sessionFile, stats: this.createStats(session) ?? undefined },
        };

      case 'compaction_end': {
        const stats = this.createStats(session);
        return stats ? { type: 'compaction_end', payload: stats } : null;
      }

      default:
        return null;
    }
  }

  private createStats(session: AgentSession): StatsData | null {
    try {
      const stats = session.getSessionStats();
      return {
        tokensIn: stats.tokens.input,
        tokensOut: stats.tokens.output,
        cacheReads: stats.tokens.cacheRead,
        cacheWrites: stats.tokens.cacheWrite,
        totalCost: stats.cost,
        contextTokens: stats.contextUsage?.tokens ?? 0,
        contextLimit: stats.contextUsage?.contextWindow ?? session.model?.contextWindow ?? DEFAULT_CONTEXT_LIMIT,
      };
    } catch (err) {
      logger.error('Failed to create session stats message:', err);
      return null;
    }
  }

  private nextApiRequestId(): string {
    return `api-req-${uuidv7()}`;
  }
}

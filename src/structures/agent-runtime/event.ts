import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AssistantMessageWithUsage } from '@extension/types/extension';
import type { ExtensionToWebviewMessage, ToolName } from '@extension/types/webview';

export class EventMapper {
  private currentApiRequestId: string | null = null;

  public resetTurnState(): void {
    this.currentApiRequestId = null;
  }

  public mapEvent(event: AgentSessionEvent, session: AgentSession, isAborted: boolean): ExtensionToWebviewMessage | null {
    if (isAborted) {
      return event.type === 'agent_settled' ? { type: 'agent_settled' } : null;
    }

    switch (event.type) {
      case 'agent_start':
        return {
          type: 'agent_start',
          payload: { path: session.sessionFile },
        };

      case 'turn_start': {
        this.currentApiRequestId = `api-req-${Date.now()}`;
        return {
          type: 'api_request_start',
          payload: { id: this.currentApiRequestId, timestamp: Date.now() },
        };
      }

      case 'turn_end': {
        const id = this.currentApiRequestId || `api-req-${Date.now()}`;
        this.currentApiRequestId = null;
        const msg = event.message?.role === 'assistant' ? (event.message as AssistantMessageWithUsage) : undefined;
        return {
          type: 'api_request_end',
          payload: {
            id,
            cost: msg?.usage?.cost?.total,
            error: msg?.stopReason === 'error' ? msg.errorMessage : undefined,
          },
        };
      }

      case 'message_start':
        if (event.message.role !== 'user' && event.message.role !== 'assistant') {
          return null;
        }
        return {
          type: 'message_start',
          payload: { role: event.message.role, timestamp: event.message.timestamp },
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
        if (event.message.role !== 'user' && event.message.role !== 'assistant') {
          return null;
        }
        return {
          type: 'message_end',
          payload: {
            role: event.message.role,
            cost: event.message.role === 'assistant' ? (event.message as AssistantMessageWithUsage).usage?.cost?.total : undefined,
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

      case 'tool_execution_end':
        return {
          type: 'tool_execution_end',
          payload: {
            id: event.toolCallId,
            result: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
            is_error: event.isError,
          },
        };

      case 'agent_settled':
        return { type: 'agent_settled' };

      default:
        return null;
    }
  }

  public createStatsMessage(session: AgentSession): ExtensionToWebviewMessage | null {
    try {
      const stats = session.getSessionStats();
      return {
        type: 'stats_update',
        payload: {
          tokensIn: stats.tokens.input,
          tokensOut: stats.tokens.output,
          cacheReads: stats.tokens.cacheRead,
          cacheWrites: stats.tokens.cacheWrite,
          totalCost: stats.cost,
          contextTokens: stats.contextUsage?.tokens ?? 0,
          contextLimit: stats.contextUsage?.contextWindow ?? session.model?.contextWindow ?? 200000,
        },
      };
    } catch (err) {
      console.error('Failed to create session stats message:', err);
      return null;
    }
  }
}

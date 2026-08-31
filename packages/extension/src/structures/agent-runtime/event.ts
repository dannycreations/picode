import { uuidv7 } from '@earendil-works/pi-ai';

import { getSubagentSession } from '@pi-code/extension/structures/agent-runtime/brokers/tool-call';
import { SPAWN_SUBAGENT_TOOL_NAME, takeSubagentUsage } from '@pi-code/extension/structures/agent-runtime/subagent';
import { logger } from '@pi-code/shared/core/logger';
import { resolveContextLimit } from '@pi-code/shared/utilities/common';

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';
import type { StatsData, ToolName, ToolResultDetails } from '@pi-code/shared/core/types';

type SubagentEventCallback = (event: ExtensionToWebviewMessage) => void;
let subagentEventCallback: SubagentEventCallback | null = null;

export function setSubagentEventCallback(callback: SubagentEventCallback): () => void {
  subagentEventCallback = callback;
  return () => {
    if (subagentEventCallback === callback) {
      subagentEventCallback = null;
    }
  };
}

export function notifySubagentEvent(event: ExtensionToWebviewMessage): void {
  if (!subagentEventCallback) {
    logger.warn('Dropping sub-agent progress event; no webview messenger is registered.');
    return;
  }
  subagentEventCallback(event);
}

interface ToolResultPart {
  readonly type: string;
  readonly text?: string;
}

export function toolResultText(result: unknown): string {
  if (typeof result === 'string') return result;

  const content = (result as { content?: readonly ToolResultPart[] } | undefined)?.content;
  const parts = Array.isArray(content) ? content.filter((part) => part.type === 'text' && typeof part.text === 'string') : [];
  if (parts.length === 0) {
    try {
      return JSON.stringify(result) ?? '';
    } catch {
      return String(result);
    }
  }

  return parts.map((part) => part.text).join('\n');
}

function latestStep(steps: string | undefined): string | undefined {
  const lines = (steps ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : undefined;
}

interface MappedEvent {
  readonly message: ExtensionToWebviewMessage | null;
  readonly apiRequestId: string | null;
}

// Compaction restarts the turn pipeline, so it replays the same header refresh
// the webview already renders for `agent_start`.
function agentStart(session: AgentSession, apiRequestId: string | null): MappedEvent {
  return {
    message: { type: 'agent_start', payload: { path: session.sessionFile, stats: createStats(session) } },
    apiRequestId,
  };
}

export function mapEvent(event: AgentSessionEvent, session: AgentSession, apiRequestId: string | null): MappedEvent {
  const subagent = getSubagentSession(session.sessionId)?.name;

  switch (event.type) {
    case 'agent_start':
      return agentStart(session, apiRequestId);

    case 'turn_start': {
      const nextId = nextApiRequestId();
      return {
        message: {
          type: 'api_request_start',
          payload: { id: nextId, timestamp: Date.now() },
        },
        apiRequestId: nextId,
      };
    }

    case 'turn_end': {
      const id = apiRequestId || nextApiRequestId();
      const msg = event.message?.role === 'assistant' ? event.message : undefined;
      const isError = msg?.stopReason === 'error';
      return {
        message: {
          type: 'api_request_end',
          payload: {
            id,
            cost: msg?.usage?.cost?.total,
            error: isError ? msg.errorMessage || 'The API request failed.' : undefined,
            stats: createStats(session),
          },
        },
        apiRequestId: null,
      };
    }

    case 'message_start':
      if (event.message.role !== 'assistant') {
        return { message: null, apiRequestId };
      }
      return {
        message: {
          type: 'message_start',
          payload: { timestamp: event.message.timestamp },
        },
        apiRequestId,
      };

    case 'message_update': {
      const delta = event.assistantMessageEvent;
      if (delta.type === 'text_delta') {
        return { message: { type: 'stream_delta', payload: { text: delta.delta } }, apiRequestId };
      }
      if (delta.type === 'thinking_delta') {
        return { message: { type: 'stream_delta', payload: { thinking: delta.delta } }, apiRequestId };
      }
      return { message: null, apiRequestId };
    }

    case 'message_end':
      if (event.message.role !== 'assistant') {
        return { message: null, apiRequestId };
      }
      return {
        message: {
          type: 'message_end',
          payload: {
            cost: event.message.usage?.cost?.total,
            stats: createStats(session),
          },
        },
        apiRequestId,
      };

    case 'tool_execution_start': {
      return {
        message: {
          type: 'tool_execution_start',
          payload: {
            id: event.toolCallId,
            tool_name: event.toolName as ToolName,
            arguments: event.args,
            subagent,
          },
        },
        apiRequestId,
      };
    }

    case 'tool_execution_update': {
      const result = toolResultText(event.partialResult);
      const steps = (event.partialResult as { details?: { steps?: string } } | undefined)?.details?.steps;
      const subtitle = event.toolName === SPAWN_SUBAGENT_TOOL_NAME ? latestStep(steps) : undefined;
      return {
        message: {
          type: 'tool_execution_update',
          payload: { id: event.toolCallId, result, subagent, subtitle },
        },
        apiRequestId,
      };
    }

    case 'tool_execution_end': {
      const toolResult = event.result as { details?: ToolResultDetails } | undefined;
      return {
        message: {
          type: 'tool_execution_end',
          payload: {
            id: event.toolCallId,
            result: toolResultText(event.result),
            todos: toolResult?.details?.todos,
            files: toolResult?.details?.files,
            subtitle: toolResult?.details?.subtitle,
            is_error: event.isError,
            subagent,
          },
        },
        apiRequestId,
      };
    }

    case 'agent_settled': {
      const stats = createStats(session);
      if (!stats) return { message: { type: 'agent_settled' }, apiRequestId };

      // Sub-agent spend is in-memory only, so it never lands in the session
      // file. Fold this turn's delegated usage into the header stats here,
      // then clear it so the next turn accounts for its own runs.
      const child = takeSubagentUsage(session.sessionId);

      return {
        message: {
          type: 'agent_settled',
          payload: {
            ...stats,
            tokensIn: stats.tokensIn + child.tokensIn,
            tokensOut: stats.tokensOut + child.tokensOut,
            totalCost: stats.totalCost + child.cost,
          },
        },
        apiRequestId,
      };
    }

    case 'compaction_start':
      return agentStart(session, apiRequestId);

    case 'compaction_end': {
      const stats = createStats(session);
      return stats ? { message: { type: 'compaction_end', payload: stats }, apiRequestId } : { message: null, apiRequestId };
    }

    default:
      logger.debug(`Ignoring unmapped agent session event: ${event.type}`);
      return { message: null, apiRequestId };
  }
}

function createStats(session: AgentSession): StatsData | undefined {
  try {
    const stats = session.getSessionStats();
    return {
      tokensIn: stats.tokens.input,
      tokensOut: stats.tokens.output,
      cacheReads: stats.tokens.cacheRead,
      cacheWrites: stats.tokens.cacheWrite,
      totalCost: stats.cost,
      contextTokens: stats.contextUsage?.tokens ?? 0,
      contextLimit: resolveContextLimit(stats.contextUsage?.contextWindow ?? session.model?.contextWindow),
    };
  } catch (err) {
    logger.error('Failed to create session stats message:', err);
    return undefined;
  }
}

function nextApiRequestId(): string {
  return `api-req-${uuidv7()}`;
}

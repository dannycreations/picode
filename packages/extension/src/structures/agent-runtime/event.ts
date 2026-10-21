import { uuidv7 } from '@earendil-works/pi-ai';

import { getSubagentSession } from '@pi-code/extension/structures/agent-runtime/brokers/tool-call';
import { SPAWN_SUBAGENT_TOOL_NAME, takeSubagentUsage } from '@pi-code/extension/structures/agent-runtime/subagent';
import { logger } from '@pi-code/shared/core/logger';
import { isSubagentEvent } from '@pi-code/shared/core/protocol';
import { isWhitespaceCode, resolveContextLimit } from '@pi-code/shared/utilities/common';

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { ExtensionToWebviewMessage, SubagentEvent } from '@pi-code/shared/core/protocol';
import type { StatsData, ToolName, ToolResultDetails } from '@pi-code/shared/core/types';

type SubagentEventCallback = (event: ExtensionToWebviewMessage) => void;
let subagentEventCallback: SubagentEventCallback | null = null;

interface SessionStatsEntry {
  readonly entryCount: number;
  readonly modelKey: string;
  readonly stats: StatsData;
}

const statsCache = new WeakMap<AgentSession, SessionStatsEntry>();

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
  if (result === undefined) return '';

  const content = (result as { content?: readonly ToolResultPart[] } | undefined)?.content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const part of content) {
      if (part.type !== 'text' || typeof part.text !== 'string') continue;
      texts.push(part.text);
    }
    if (texts.length > 0) return texts.join('\n');
  }

  try {
    return JSON.stringify(result) ?? '';
  } catch {
    return String(result);
  }
}

function latestStep(steps: string | undefined): string | undefined {
  if (!steps) return undefined;

  let end = steps.length;
  while (end > 0) {
    const breakIndex = steps.lastIndexOf('\n', end - 1);
    const start = breakIndex === -1 ? 0 : breakIndex + 1;

    let from = start;
    while (from < end && isWhitespaceCode(steps.charCodeAt(from))) from++;
    if (from < end) {
      let to = end;
      while (to > from && isWhitespaceCode(steps.charCodeAt(to - 1))) to--;
      return steps.slice(from, to);
    }

    if (breakIndex === -1) return undefined;
    end = breakIndex;
  }
  return undefined;
}

interface MappedEvent {
  readonly message: ExtensionToWebviewMessage | null;
  readonly apiRequestId: string | null;
}

export function mapEvent(event: AgentSessionEvent, session: AgentSession, apiRequestId: string | null): MappedEvent {
  switch (event.type) {
    case 'agent_start':
      return {
        message: { type: 'agent_start', payload: { path: session.sessionFile, stats: createStats(session) } },
        apiRequestId,
      };

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

    case 'auto_retry_start':
      return { message: { type: 'api_retry_start', payload: { delayMs: event.delayMs } }, apiRequestId };

    case 'auto_retry_end':
      return { message: { type: 'api_retry_end' }, apiRequestId };

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

    // Only the tool cases need the owning sub-agent, and a session can emit
    // thousands of streaming deltas per turn, so the lookup stays inside them.
    case 'tool_execution_start': {
      const subagent = getSubagentSession(session.sessionId)?.name;
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
      const subagent = getSubagentSession(session.sessionId)?.name;
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
      const subagent = getSubagentSession(session.sessionId)?.name;
      const toolResult = event.result as { details?: ToolResultDetails } | undefined;
      const details = toolResult?.details;
      return {
        message: {
          type: 'tool_execution_end',
          payload: {
            id: event.toolCallId,
            result: toolResultText(event.result),
            diff: details?.diff,
            duration: details?.duration,
            todos: details?.todos,
            files: details?.files,
            subtitle: details?.subtitle,
            exit_code: details?.exitCode,
            cancelled: details?.cancelled,
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
      return { message: { type: 'compaction_start' }, apiRequestId };

    case 'compaction_end': {
      // The compaction rewrote the branch the context usage is read from.
      statsCache.delete(session);
      const stats = createStats(session);
      return stats ? { message: { type: 'compaction_end', payload: stats }, apiRequestId } : { message: null, apiRequestId };
    }

    default:
      logger.debug(`Ignoring unmapped agent session event: ${event.type}`);
      return { message: null, apiRequestId };
  }
}

function withoutSubagent<T extends { readonly subagent?: string }>(payload: T): Omit<T, 'subagent'> {
  const { subagent: _subagent, ...rest } = payload;
  return rest;
}

export function toSubagentEvent(message: ExtensionToWebviewMessage): SubagentEvent | null {
  if (!isSubagentEvent(message)) return null;

  // The sub-agent pane does not render the owning sub-agent, so the field is
  // dropped from the three tool events that carry it.
  switch (message.type) {
    case 'tool_execution_start':
      return { type: message.type, payload: withoutSubagent(message.payload) };
    case 'tool_execution_update':
      return { type: message.type, payload: withoutSubagent(message.payload) };
    case 'tool_execution_end':
      return { type: message.type, payload: withoutSubagent(message.payload) };
    default:
      return message;
  }
}

export function createStats(session: AgentSession): StatsData | undefined {
  try {
    const entryCount = session.sessionManager?.getEntryCount?.();
    // The context window comes from the routed model when one is set, so the
    // key names that model. Two providers can share a model id, and a switch
    // between them changes the limit without changing the entry count.
    const limitsModel = session.routedModel?.model ?? session.model;
    const modelKey = limitsModel ? `${limitsModel.provider}/${limitsModel.id}` : '';
    const cached = entryCount === undefined ? undefined : statsCache.get(session);
    if (cached && cached.entryCount === entryCount && cached.modelKey === modelKey) return cached.stats;

    const stats = session.getSessionStats();
    const result: StatsData = {
      tokensIn: stats.tokens.input,
      tokensOut: stats.tokens.output,
      cacheReads: stats.tokens.cacheRead,
      cacheWrites: stats.tokens.cacheWrite,
      totalCost: stats.cost,
      contextTokens: stats.contextUsage?.tokens ?? 0,
      contextLimit: resolveContextLimit(stats.contextUsage?.contextWindow ?? session.model?.contextWindow),
    };
    if (entryCount !== undefined) statsCache.set(session, { entryCount, modelKey, stats: result });
    return result;
  } catch (err) {
    logger.error('Failed to create session stats message:', err);
    return undefined;
  }
}

function nextApiRequestId(): string {
  return `api-req-${uuidv7()}`;
}

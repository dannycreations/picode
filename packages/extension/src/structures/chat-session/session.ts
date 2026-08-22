import { contentText, uuidv7 } from '@earendil-works/pi-ai';
import { calculateContextTokens, getLastAssistantUsage } from '@earendil-works/pi-coding-agent';

import { getApprovalDuration } from '@pi-code/extension/structures/agent-runtime/brokers/tool-call';
import { toBase64DataUrl } from '@pi-code/extension/utilities/codec';
import { logger } from '@pi-code/shared/core/logger';
import { elapsedSeconds, EMPTY_STATS } from '@pi-code/shared/utilities/common';
import { buildToolSections } from '@pi-code/shared/utilities/tool';

import type { ImageContent, TextContent, ThinkingContent, ToolCall, Usage } from '@earendil-works/pi-ai';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { ChatMessage, StatsData, ToolArguments, ToolName, ToolResultDetails } from '@pi-code/shared/core/types';

type MessageContentPart = TextContent | ThinkingContent | ToolCall | ImageContent;

function toContentParts(content: string | readonly MessageContentPart[]): readonly MessageContentPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content;
}

function joinThinking(parts: readonly MessageContentPart[]): string {
  return parts
    .filter((part) => part.type === 'thinking')
    .map((part) => part.thinking)
    .join('\n');
}

function collectImages(parts: readonly MessageContentPart[]): string[] {
  return parts.filter((part) => part.type === 'image').map((part) => toBase64DataUrl(part.data, part.mimeType));
}

export function convertSessionEntries(entries: readonly SessionEntry[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const entry of entries) {
    const ts = new Date(entry.timestamp).getTime();

    switch (entry.type) {
      case 'compaction':
        result.push({ id: entry.id, sender: 'info', text: `Compacted: ${entry.summary}`, ts });
        break;

      case 'label':
        if (entry.label) {
          result.push({ id: entry.id, sender: 'checkpoint', text: 'Checkpoint saved', ts });
        }
        break;

      case 'message':
        appendMessage(result, entry.id, entry.message, ts);
        break;
    }
  }

  return result;
}

type SessionMessage = Extract<SessionEntry, { type: 'message' }>['message'];

function appendMessage(result: ChatMessage[], id: string, msg: SessionMessage, ts: number): void {
  switch (msg.role) {
    case 'user': {
      const images = collectImages(toContentParts(msg.content));
      result.push({
        id,
        sender: 'user',
        text: contentText(msg.content).trim(),
        images: images.length > 0 ? images : undefined,
        ts,
      });
      break;
    }

    case 'assistant':
      appendAssistantTurn(result, id, msg, ts);
      break;

    // A tool result is not a row of its own: it completes the `tool` row that
    // the assistant's matching tool call already pushed.
    case 'toolResult':
      patchToolCall(result, msg, ts);
      break;

    case 'bashExecution':
      result.push({
        id,
        sender: 'tool',
        text: msg.command,
        toolName: 'execute_command',
        toolArgs: { command: msg.command },
        toolStatus: msg.cancelled ? 'denied' : 'completed',
        diff: msg.output,
        duration: 0,
        ts,
      });
      break;

    default:
      logger.warn(`Unhandled session message role during transcript conversion: ${msg.role}`);
      break;
  }
}

function appendAssistantTurn(result: ChatMessage[], id: string, msg: Extract<SessionMessage, { role: 'assistant' }>, ts: number): void {
  const parts = toContentParts(msg.content);
  const cost = msg.usage?.cost?.total;
  const errorMessage = msg.errorMessage;

  result.push({
    id: `${id}-api-req`,
    sender: 'api_request',
    text: 'API Request',
    ts: ts - 1,
    toolStatus: errorMessage ? 'denied' : 'completed',
    errorMessage,
    cost,
  });

  result.push({
    id,
    sender: 'assistant',
    text: contentText(msg.content),
    reasoning: joinThinking(parts),
    cost,
    ts,
  });

  for (const toolCall of parts.filter((part) => part.type === 'toolCall')) {
    result.push({
      id: toolCall.id || uuidv7(),
      sender: 'tool',
      text: toolCall.name,
      toolName: toolCall.name as ToolName,
      toolArgs: toolCall.arguments as ToolArguments,
      toolStatus: 'completed',
      ts,
    });
  }

  if (errorMessage) {
    result.push({ id: `${id}-error`, sender: 'error', text: errorMessage, errorMessage, ts });
  }
}

function patchToolCall(result: ChatMessage[], msg: Extract<SessionMessage, { role: 'toolResult' }>, ts: number): void {
  const index = result.findIndex((r) => r.sender === 'tool' && r.id === msg.toolCallId);
  if (index === -1) return;

  const existing = result[index];
  if (existing.sender !== 'tool') return;

  const resultText = contentText(msg.content);
  const details: ToolResultDetails | undefined = msg.details;

  const rawDuration = elapsedSeconds(existing.ts, ts);
  const approvalMs = msg.toolCallId ? getApprovalDuration(msg.toolCallId) : undefined;
  const netDuration = approvalMs !== undefined ? elapsedSeconds(existing.ts, ts - approvalMs) : rawDuration;

  result[index] = {
    ...existing,
    toolStatus: msg.isError ? 'denied' : 'completed',
    diff: details?.diff || resultText,
    todos: details?.todos,
    files: details?.files,
    duration: details?.duration !== undefined ? details.duration : netDuration,
    errorMessage: msg.isError ? resultText : existing.errorMessage,
    subtitle: details?.subtitle,
  };
}

function calculateSessionStats(entries: readonly SessionEntry[], contextLimit: number = EMPTY_STATS.contextLimit): StatsData {
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheWrites = 0;
  let cacheReads = 0;
  let totalCost = 0;
  let contextTokens = 0;

  const addUsage = (usage: Usage | undefined): void => {
    if (!usage) return;
    tokensIn += usage.input;
    tokensOut += usage.output;
    cacheReads += usage.cacheRead;
    cacheWrites += usage.cacheWrite;
    totalCost += usage.cost.total;
  };

  for (const entry of entries) {
    if (entry.type === 'compaction' || entry.type === 'branch_summary') {
      addUsage(entry.usage);
    } else if (entry.type === 'message' && (entry.message.role === 'assistant' || entry.message.role === 'toolResult')) {
      addUsage(entry.message.usage);
    }
  }

  try {
    const lastUsage = getLastAssistantUsage([...entries]);
    if (lastUsage) {
      contextTokens = calculateContextTokens(lastUsage);
    }
  } catch (err) {
    logger.error('Failed to get last assistant usage:', err);
  }

  return {
    tokensIn,
    tokensOut,
    cacheWrites,
    cacheReads,
    totalCost,
    contextTokens,
    contextLimit,
  };
}

export function loadSessionTranscript(entries: readonly SessionEntry[], contextLimit: number): { messages: ChatMessage[]; stats: StatsData } {
  const messages = convertSessionEntries(entries).map((message) =>
    message.sender === 'tool' ? { ...message, toolSections: buildToolSections(message) } : message,
  );
  const stats = calculateSessionStats(entries, contextLimit);
  return { messages, stats };
}

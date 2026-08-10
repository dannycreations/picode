import { calculateContextTokens, getLastAssistantUsage, parseSkillBlock } from '@earendil-works/pi-coding-agent';

import { toBase64DataUrl } from '@pi-code/extension/utilities/codec';
import { DEFAULT_CONTEXT_LIMIT } from '@pi-code/shared/core/constants';
import { logger } from '@pi-code/shared/core/logger';

import type { ImageContent, TextContent, ThinkingContent, ToolCall, Usage } from '@earendil-works/pi-ai';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { ChatMessage, StatsData, ToolName } from '@pi-code/shared/core/protocol';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

type MessageContentPart = TextContent | ThinkingContent | ToolCall | ImageContent;

interface ToolResultDetails {
  readonly diff?: string;
  readonly todos?: TodoItem[];
}

function toContentParts(content: string | readonly MessageContentPart[]): readonly MessageContentPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content;
}

function joinText(parts: readonly MessageContentPart[]): string {
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
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

export function collapseSkillBlock(text: string): string {
  const parsed = parseSkillBlock(text);
  if (!parsed) return text;

  const command = `/skill:${parsed.name}`;
  return parsed.userMessage ? `${command} ${parsed.userMessage}` : command;
}

export function convertSessionEntries(entries: readonly SessionEntry[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const entry of entries) {
    const timestamp = new Date(entry.timestamp).getTime();

    if (entry.type === 'compaction') {
      result.push({
        id: entry.id,
        sender: 'info',
        text: `Compacted: ${entry.summary}`,
        ts: timestamp,
      });
      continue;
    }

    if (entry.type === 'label') {
      if (entry.label) {
        result.push({
          id: entry.id,
          sender: 'checkpoint',
          text: 'Checkpoint saved',
          ts: timestamp,
        });
      }
      continue;
    }

    if (entry.type !== 'message') {
      continue;
    }

    const msg = entry.message;
    if (msg.role === 'user') {
      const parts = toContentParts(msg.content);
      const images = collectImages(parts);
      result.push({
        id: entry.id,
        sender: 'user',
        text: collapseSkillBlock(joinText(parts).trim()),
        images: images.length > 0 ? images : undefined,
        ts: timestamp,
      });
    } else if (msg.role === 'assistant') {
      const parts = toContentParts(msg.content);
      const cost = msg.usage?.cost?.total;
      const errorMessage = msg.errorMessage;

      result.push({
        id: `${entry.id}-api-req`,
        sender: 'api_request',
        text: 'API Request',
        ts: timestamp - 1,
        toolStatus: errorMessage ? 'denied' : 'completed',
        errorMessage,
        cost,
      });

      result.push({
        id: entry.id,
        sender: 'assistant',
        text: joinText(parts),
        reasoning: joinThinking(parts),
        cost,
        ts: timestamp,
      });

      for (const toolCall of parts.filter((part) => part.type === 'toolCall')) {
        result.push({
          id: toolCall.id || `tc-${Date.now()}`,
          sender: 'tool',
          text: toolCall.name,
          toolName: toolCall.name as ToolName,
          toolArgs: typeof toolCall.arguments === 'string' ? toolCall.arguments : JSON.stringify(toolCall.arguments),
          toolStatus: 'completed',
          ts: timestamp,
        });
      }

      if (errorMessage) {
        result.push({
          id: `${entry.id}-error`,
          sender: 'error',
          text: errorMessage,
          errorMessage,
          ts: timestamp,
        });
      }
    } else if (msg.role === 'toolResult') {
      const existingIndex = result.findIndex((r) => r.sender === 'tool' && r.id === msg.toolCallId);
      if (existingIndex !== -1) {
        const existingToolMsg = result[existingIndex];
        const contentText = joinText(toContentParts(msg.content));
        const details: ToolResultDetails | undefined = msg.details;

        result[existingIndex] = {
          ...existingToolMsg,
          toolStatus: msg.isError ? 'denied' : 'completed',
          diff: details?.diff || contentText,
          todos: details?.todos,
          errorMessage: msg.isError ? contentText : existingToolMsg.errorMessage,
        };
      }
    } else if (msg.role === 'bashExecution') {
      result.push({
        id: entry.id,
        sender: 'tool',
        text: msg.command,
        toolName: 'execute_command',
        toolArgs: `command: ${msg.command}`,
        toolStatus: msg.cancelled ? 'denied' : 'completed',
        diff: msg.output,
        ts: timestamp,
      });
    }
  }
  return result;
}

export function calculateSessionStats(entries: readonly SessionEntry[], contextLimit: number = DEFAULT_CONTEXT_LIMIT): StatsData {
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

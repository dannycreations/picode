import { getLastAssistantUsage, parseSkillBlock } from '@earendil-works/pi-coding-agent';

import { toBase64DataUrl } from '@pi-code/extension/utilities/codec';
import { DEFAULT_CONTEXT_LIMIT } from '@pi-code/shared/constants';
import { logger } from '@pi-code/shared/logger';

import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { SessionMessageContent, SessionTreeEntry } from '@pi-code/extension/types/extension';
import type { ChatMessage, StatsData, ToolName } from '@pi-code/shared/protocol';

export function collapseSkillBlock(text: string): string {
  const parsed = parseSkillBlock(text);
  if (!parsed) return text;

  const command = `/skill:${parsed.name}`;
  return parsed.userMessage ? `${command} ${parsed.userMessage}` : command;
}

export function convertSessionEntries(entries: SessionTreeEntry[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const entry of entries) {
    if (entry.type === 'message') {
      const msg = entry.message;
      if (msg.role === 'user') {
        let text = '';
        let images: string[] = [];
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter((c: SessionMessageContent) => c.type === 'text')
            .map((c: SessionMessageContent) => c.text)
            .join('\n');
          images = msg.content
            .filter((c: SessionMessageContent) => c.type === 'image' && c.data)
            .map((c: SessionMessageContent) => toBase64DataUrl(c.data ?? '', c.mimeType ?? ''));
        }
        result.push({
          id: entry.id,
          sender: 'user',
          text: collapseSkillBlock(text.trim()),
          images: images.length > 0 ? images : undefined,
          ts: new Date(entry.timestamp).getTime(),
        });
      } else if (msg.role === 'assistant') {
        let text = '';
        let reasoning = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          text = msg.content
            .filter((c: SessionMessageContent) => c.type === 'text')
            .map((c: SessionMessageContent) => c.text)
            .join('\n');
          reasoning = msg.content
            .filter((c: SessionMessageContent) => c.type === 'thinking')
            .map((c: SessionMessageContent) => c.text || c.thinking)
            .join('\n');
        }

        const timestamp = new Date(entry.timestamp).getTime();
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
          text,
          reasoning,
          cost,
          ts: timestamp,
        });

        // Add tool calls if any
        if (Array.isArray(msg.content)) {
          const toolCalls = msg.content.filter((c: SessionMessageContent) => c.type === 'toolCall');
          for (const tc of toolCalls) {
            result.push({
              id: tc.id || `tc-${Date.now()}`,
              sender: 'tool',
              text: tc.name || '',
              toolName: tc.name ? (tc.name as ToolName) : undefined,
              toolArgs: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
              toolStatus: 'completed',
              ts: new Date(entry.timestamp).getTime(),
            });
          }
        }

        if (errorMessage) {
          result.push({
            id: entry.id + '-error',
            sender: 'error',
            text: errorMessage,
            errorMessage,
            ts: timestamp,
          });
        }
      } else if (msg.role === 'toolResult') {
        const toolCallId = msg.toolCallId;
        const existingIndex = result.findIndex((r) => r.sender === 'tool' && r.id === toolCallId);
        if (existingIndex !== -1) {
          const existingToolMsg = result[existingIndex];
          let contentText = '';
          if (typeof msg.content === 'string') {
            contentText = msg.content;
          } else if (Array.isArray(msg.content)) {
            contentText = msg.content
              .filter((c: SessionMessageContent) => c.type === 'text')
              .map((c: SessionMessageContent) => c.text)
              .join('\n');
          }

          result[existingIndex] = {
            ...existingToolMsg,
            toolStatus: msg.isError ? 'denied' : 'completed',
            diff: msg.details?.diff || contentText,
            todos: msg.details?.todos,
            errorMessage: msg.isError ? contentText : existingToolMsg.errorMessage,
          };
        }
      } else if (msg.role === 'bashExecution') {
        result.push({
          id: entry.id,
          sender: 'tool',
          text: msg.command || '',
          toolName: 'execute_command',
          toolArgs: `command: ${msg.command || ''}`,
          toolStatus: msg.cancelled ? 'denied' : 'completed',
          diff: msg.output,
          ts: new Date(entry.timestamp).getTime(),
        });
      }
    } else if (entry.type === 'compaction') {
      result.push({
        id: entry.id,
        sender: 'info',
        text: `Compacted: ${entry.summary}`,
        ts: new Date(entry.timestamp).getTime(),
      });
    } else if (entry.type === 'label') {
      if (entry.label) {
        result.push({
          id: entry.id,
          sender: 'checkpoint',
          text: 'Checkpoint saved',
          ts: new Date(entry.timestamp).getTime(),
        });
      }
    }
  }
  return result;
}

export function calculateSessionStats(entries: SessionTreeEntry[], contextLimit: number = DEFAULT_CONTEXT_LIMIT): StatsData {
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheWrites = 0;
  let cacheReads = 0;
  let totalCost = 0;
  let contextTokens = 0;

  for (const entry of entries) {
    if (entry.type === 'message' && entry.message.role === 'assistant') {
      const usage = entry.message.usage;
      if (usage) {
        if (typeof usage.input === 'number') {
          tokensIn += usage.input;
        }
        if (typeof usage.output === 'number') {
          tokensOut += usage.output;
        }
        if (typeof usage.cacheRead === 'number') {
          cacheReads += usage.cacheRead;
        }
        if (typeof usage.cacheWrite === 'number') {
          cacheWrites += usage.cacheWrite;
        }
        if (usage.cost && typeof usage.cost.total === 'number') {
          totalCost += usage.cost.total;
        }
      }
    }
  }

  try {
    const lastUsage = getLastAssistantUsage(entries as SessionEntry[]);
    if (lastUsage) {
      contextTokens = lastUsage.totalTokens || lastUsage.input + lastUsage.output + (lastUsage.cacheRead || 0) + (lastUsage.cacheWrite || 0);
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

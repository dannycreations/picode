import { beforeEach, describe, expect, it } from 'vitest';

import { clearApprovalDurations, recordApprovalDuration } from '@pi-code/extension/structures/agent-runtime/brokers/tool-call';
import { convertSessionEntries } from '@pi-code/extension/structures/chat-session/session';

import type { AssistantMessage, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { ToolChatMessage } from '@pi-code/shared/core/types';

beforeEach(() => {
  // recordApprovalDuration writes module state keyed by tool call id.
  clearApprovalDurations();
});

function messageEntry(id: string, message: UserMessage | AssistantMessage | ToolResultMessage): SessionEntry {
  return { id, type: 'message', parentId: null, timestamp: new Date().toISOString(), message };
}

function assistantMessage(content: AssistantMessage['content']): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'test-model',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

function toolResultMessage(toolCallId: string, toolName: string, text: string, details?: unknown): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text }],
    details,
    isError: false,
    timestamp: Date.now(),
  };
}

describe('convertSessionEntries todo parsing', () => {
  it('attaches the parsed update_todo list to the message', () => {
    const todos = [
      { content: 'Task A', status: 'pending' as const },
      { content: 'Task B', status: 'completed' as const },
    ];
    const entries = [
      messageEntry('m1', assistantMessage([{ type: 'toolCall', id: 'tc1', name: 'update_todo', arguments: { todos: '- [ ] a' } }])),
      messageEntry('m2', toolResultMessage('tc1', 'update_todo', 'update_todo success.', { todos })),
    ];

    const messages = convertSessionEntries(entries);
    const todoMsg = messages.find((m) => m.sender === 'tool' && m.toolName === 'update_todo');

    expect((todoMsg as ToolChatMessage | undefined)?.todos).toEqual(todos);
  });
});

describe('convertSessionEntries tool duration with approval pause', () => {
  it('should subtract approval duration from tool call duration', () => {
    const toolCallId = 'tc-paused-1';

    // Record that the approval took 5000 milliseconds (5 seconds)
    recordApprovalDuration(toolCallId, 5000);

    const callTime = new Date('2026-08-16T08:00:00.000Z');
    const resultTime = new Date('2026-08-16T08:00:08.000Z'); // 8 seconds total wall time

    const entries: SessionEntry[] = [
      {
        id: 'm1',
        type: 'message',
        parentId: null,
        timestamp: callTime.toISOString(),
        message: assistantMessage([{ type: 'toolCall', id: toolCallId, name: 'execute_command', arguments: { command: 'npm run test' } }]),
      },
      {
        id: 'm2',
        type: 'message',
        parentId: null,
        timestamp: resultTime.toISOString(),
        message: toolResultMessage(toolCallId, 'execute_command', 'success', {}),
      },
    ];

    const messages = convertSessionEntries(entries);
    const toolMsg = messages.find((m) => m.id === toolCallId);

    // Total wall time: 8 seconds
    // Approval duration: 5 seconds
    // Net execution duration: 8 - 5 = 3 seconds
    expect((toolMsg as ToolChatMessage | undefined)?.duration).toBe(3);
  });
});

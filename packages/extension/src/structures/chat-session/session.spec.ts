import { describe, expect, it } from 'vitest';

import { recordApprovalDuration } from '@pi-code/extension/structures/agent-runtime/brokers/approval';
import { convertSessionEntries, loadSessionTranscript, loadSubagentTranscript } from '@pi-code/extension/structures/chat-session/session';

import type { AssistantMessage, ImageContent, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai';
import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { ChatMessage, ToolChatMessage } from '@pi-code/shared/core/types';

function messageEntry(id: string, message: UserMessage | AssistantMessage | ToolResultMessage): SessionEntry {
  return { id, type: 'message', parentId: null, timestamp: new Date().toISOString(), message };
}

function compactionEntry(id: string): SessionEntry {
  return {
    id,
    type: 'compaction',
    parentId: null,
    timestamp: new Date().toISOString(),
    summary: 'Earlier work',
    firstKeptEntryId: id,
    tokensBefore: 650_000,
  } as SessionEntry;
}

function assistantMessage(content: AssistantMessage['content'], overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'test-model',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop',
    timestamp: Date.now(),
    ...overrides,
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
  } as never;
}

describe('convertSessionEntries todo parsing', () => {
  it('attaches the parsed update_todo list to the message', () => {
    const todos = [
      { content: 'Task A', status: 'open' as const },
      { content: 'Task B', status: 'closed' as const },
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

describe('convertSessionEntries tool rows across an errored turn', () => {
  it('drops the tool row when the turn ended in error', () => {
    // Mirrors an upstream idle timeout: the stream dies mid-call, the tool
    // call's arguments parse to {}, and the turn ends in error. No tool ran,
    // so the replay must not render a completed tool card for it.
    const entries = [
      messageEntry(
        'm1',
        assistantMessage(
          [
            { type: 'text', text: 'Now the port itself:' },
            { type: 'toolCall', id: 'tc1', name: 'write_file', arguments: {} },
          ],
          { stopReason: 'error', errorMessage: 'Upstream idle timeout exceeded' },
        ),
      ),
    ];

    const messages = convertSessionEntries(entries);

    expect(messages.some((m) => m.sender === 'tool')).toBe(false);
    const request = messages.find((m) => m.sender === 'api_request');
    expect(request?.toolStatus).toBe('denied');
    expect(request?.errorMessage).toBe('Upstream idle timeout exceeded');
  });

  it('keeps the tool row when the turn dispatched its tool call', () => {
    const entries = [
      messageEntry('m1', assistantMessage([{ type: 'toolCall', id: 'tc1', name: 'write_file', arguments: { path: 'a.ts', content: 'x' } }])),
    ];

    const messages = convertSessionEntries(entries);

    const toolMsg = messages.find((m) => m.sender === 'tool');
    expect(toolMsg?.id).toBe('tc1');
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

describe('convertSessionEntries text attachment rehydration', () => {
  function userEntry(id: string, content: UserMessage['content']): SessionEntry {
    return { id, type: 'message', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content, timestamp: Date.now() } };
  }

  function textAttachmentEntry(id: string, parentId: string, content = '``` ts\ncode\n```'): SessionEntry {
    return {
      id,
      type: 'custom_message',
      parentId,
      timestamp: new Date().toISOString(),
      customType: 'text_attachment',
      content,
      display: false,
    };
  }

  it('restores a text attachment from the tagged custom entry by parsing its content', () => {
    const entries: SessionEntry[] = [userEntry('u1', 'look at this file'), textAttachmentEntry('a1', 'u1')];

    const user = convertSessionEntries(entries).find((m): m is Extract<ChatMessage, { sender: 'user' }> => m.sender === 'user');

    expect(user?.attachments).toEqual([{ kind: 'text', content: 'code', language: 'ts' }]);
  });

  it('ignores a text_attachment entry whose details are not the text tag', () => {
    const entries: SessionEntry[] = [userEntry('u1', 'look at this file'), textAttachmentEntry('a1', 'u1', 'this entry is not a fenced code block')];

    const user = convertSessionEntries(entries).find((m): m is Extract<ChatMessage, { sender: 'user' }> => m.sender === 'user');

    expect(user?.attachments).toBeUndefined();
  });

  it('combines a text attachment with an image attachment on the same user message', () => {
    const image: ImageContent = { type: 'image', data: 'BASE64DATA', mimeType: 'image/png' };
    const entries: SessionEntry[] = [userEntry('u1', [{ type: 'text', text: 'both kinds' }, image]), textAttachmentEntry('a1', 'u1')];

    const user = convertSessionEntries(entries).find((m): m is Extract<ChatMessage, { sender: 'user' }> => m.sender === 'user');

    expect(user?.attachments?.map((a) => a.kind).sort()).toEqual(['image', 'text']);
  });

  it('drops a text attachment whose ancestor chain reaches no user message', () => {
    const entries: SessionEntry[] = [
      userEntry('u1', 'first'),
      // Orphaned: parentId points at nothing in the entry set.
      textAttachmentEntry('a1', 'missing'),
    ];

    const user = convertSessionEntries(entries).find((m): m is Extract<ChatMessage, { sender: 'user' }> => m.sender === 'user');

    expect(user?.attachments).toBeUndefined();
  });
});

describe('loadSessionTranscript context size', () => {
  function measuredAssistant(id: string, totalTokens: number): SessionEntry {
    return messageEntry(
      id,
      assistantMessage([{ type: 'text', text: 'ok' }], {
        usage: {
          input: totalTokens,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }),
    );
  }

  it('reports the context of a session that was never compacted', () => {
    const { stats } = loadSessionTranscript([measuredAssistant('m1', 120_000)], 1_000_000);

    expect(stats.contextTokens).toBe(120_000);
  });

  it('leaves the context unknown while a compacted session has no measured turn', () => {
    // The usage the assistant measured before the compaction describes a
    // context that no longer exists.
    const entries = [measuredAssistant('m1', 650_000), compactionEntry('c1')];

    const { stats } = loadSessionTranscript(entries, 1_000_000);

    expect(stats.contextTokens).toBeNull();
  });

  it('reports the context a turn after the compaction measured', () => {
    const entries = [measuredAssistant('m1', 650_000), compactionEntry('c1'), measuredAssistant('m2', 466_000)];

    const { stats } = loadSessionTranscript(entries, 1_000_000);

    expect(stats.contextTokens).toBe(466_000);
  });
});

describe('loadSubagentTranscript', () => {
  function subagentSession(entries: SessionEntry[], streamingMessage?: AssistantMessage): AgentSession {
    return {
      sessionId: 'sub-1',
      sessionManager: { getBranch: () => entries },
      model: { contextWindow: 100_000 },
      agent: { state: { streamingMessage } },
    } as unknown as AgentSession;
  }

  function userEntry(id: string, content: UserMessage['content']): SessionEntry {
    return { id, type: 'message', parentId: null, timestamp: new Date().toISOString(), message: { role: 'user', content, timestamp: Date.now() } };
  }

  it('shows the delegated brief instead of the instructions the child was given', () => {
    // The child receives the agent's standing rules and the brief as one
    // prompt, so the raw first user message is mostly boilerplate.
    const session = subagentSession([userEntry('u1', 'AGENT RULES\n\n## Task\n\nfind the leak')]);

    const { messages } = loadSubagentTranscript(session, 'find the leak');

    expect(messages.find((m) => m.sender === 'user')?.text).toBe('find the leak');
  });

  it('adds the response that is still streaming so its text has a row to land on', () => {
    const streaming = assistantMessage([{ type: 'text', text: 'half a sen' }]);
    const session = subagentSession([userEntry('u1', 'find the leak')], streaming);

    const { messages } = loadSubagentTranscript(session, 'find the leak');

    const assistant = messages.find((m) => m.sender === 'assistant');
    expect(assistant?.text).toBe('half a sen');
  });

  it('keeps the transcript of a finished sub-agent', () => {
    const session = subagentSession([
      userEntry('u1', 'find the leak'),
      messageEntry('m1', assistantMessage([{ type: 'text', text: 'the leak is in foo()' }])),
    ]);

    const { messages } = loadSubagentTranscript(session, 'find the leak');

    expect(messages.map((m) => m.sender)).toEqual(['user', 'api_request', 'assistant']);
  });

  it('shows a call that has not produced a result as still running', () => {
    // The call is waiting on an approval, so replaying it as finished would
    // claim a write that never happened.
    const session = subagentSession([
      userEntry('u1', 'fix the leak'),
      messageEntry('m1', assistantMessage([{ type: 'toolCall', id: 'tc1', name: 'write_file', arguments: { path: 'a.ts', content: 'x' } }])),
    ]);

    const { messages } = loadSubagentTranscript(session, 'fix the leak');

    const tool = messages.find((m) => m.sender === 'tool');
    expect(tool?.toolStatus).toBe('running');
  });

  it('shows a call whose result arrived as finished', () => {
    const session = subagentSession([
      userEntry('u1', 'fix the leak'),
      messageEntry('m1', assistantMessage([{ type: 'toolCall', id: 'tc1', name: 'write_file', arguments: { path: 'a.ts', content: 'x' } }])),
      messageEntry('m2', toolResultMessage('tc1', 'write_file', 'wrote a.ts')),
    ]);

    const { messages } = loadSubagentTranscript(session, 'fix the leak');

    const tool = messages.find((m) => m.sender === 'tool');
    expect(tool?.toolStatus).toBe('completed');
  });
});

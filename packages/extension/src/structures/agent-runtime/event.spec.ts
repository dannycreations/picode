import { describe, expect, it, vi } from 'vitest';

import { registerSubagentSession, unregisterSubagentSession } from '@pi-code/extension/structures/agent-runtime/brokers/tool-call';
import { mapEvent, toolResultText } from '@pi-code/extension/structures/agent-runtime/event';
import { recordSubagentUsage, takeSubagentUsage } from '@pi-code/extension/structures/agent-runtime/subagent';
import { logger } from '@pi-code/shared/core/logger';

describe('toolResultText', () => {
  it('passes a plain string result through unchanged', () => {
    expect(toolResultText('done')).toBe('done');
  });

  it('extracts the text the model receives so live rows match a reloaded session', () => {
    const result = { content: [{ type: 'text', text: 'line one' }], details: { diff: 'ignored' } };

    expect(toolResultText(result)).toBe('line one');
  });

  it('joins every text part', () => {
    const result = {
      content: [
        { type: 'text', text: 'first' },
        { type: 'image', data: '...' },
        { type: 'text', text: 'second' },
      ],
    };

    expect(toolResultText(result)).toBe('first\nsecond');
  });

  it('falls back to the raw payload when no text part is present', () => {
    const result = { content: [{ type: 'image', data: 'abc' }] };

    expect(toolResultText(result)).toBe(JSON.stringify(result));
  });

  it('never returns undefined for an empty result', () => {
    expect(toolResultText(undefined)).toBe('');
  });
});

describe('mapEvent', () => {
  const makeSession = (overrides: Record<string, unknown> = {}) =>
    ({
      sessionId: 'test-session-123',
      sessionFile: 'test.json',
      model: { contextWindow: 1000 },
      getSessionStats: () => ({
        tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 },
        cost: 0.5,
        contextUsage: { tokens: 30, contextWindow: 1000 },
      }),
      ...overrides,
    }) as any;

  it('maps tool_execution_start event with subagent info if registered', () => {
    const mockEvent = {
      type: 'tool_execution_start' as const,
      toolCallId: 'call-1',
      toolName: 'read_file',
      args: { path: 'file.ts' },
    } as any;

    // 1. Without subagent registration
    const result1 = mapEvent(mockEvent, makeSession(), null);
    expect(result1.message?.type).toBe('tool_execution_start');
    expect((result1.message as any).payload).toEqual({
      id: 'call-1',
      tool_name: 'read_file',
      arguments: { path: 'file.ts' },
      subagent: undefined,
    });

    // 2. With subagent registration
    registerSubagentSession('test-session-123', 'explore');
    try {
      const result2 = mapEvent(mockEvent, makeSession(), null);
      expect(result2.message?.type).toBe('tool_execution_start');
      expect((result2.message as any).payload).toEqual({
        id: 'call-1',
        tool_name: 'read_file',
        arguments: { path: 'file.ts' },
        subagent: 'explore',
      });
    } finally {
      unregisterSubagentSession('test-session-123');
    }
  });

  it('reports turn cost and clears the api request id on turn_end', () => {
    const result = mapEvent(
      { type: 'turn_end', message: { role: 'assistant', stopReason: 'stop', usage: { cost: { total: 0.25 } } } } as any,
      makeSession(),
      'api-req-1',
    );

    expect(result.apiRequestId).toBeNull();
    expect(result.message).toMatchObject({
      type: 'api_request_end',
      payload: { id: 'api-req-1', cost: 0.25, error: undefined, stats: { tokensIn: 10, tokensOut: 20, totalCost: 0.5 } },
    });
  });

  it('surfaces turn failures and falls back when the model omits an error message', () => {
    const named = mapEvent(
      { type: 'turn_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'rate limited' } } as any,
      makeSession(),
      null,
    );
    expect(named.message).toMatchObject({ type: 'api_request_end', payload: { error: 'rate limited' } });

    const silent = mapEvent({ type: 'turn_end', message: { role: 'assistant', stopReason: 'error' } } as any, makeSession(), null);
    expect(silent.message).toMatchObject({ type: 'api_request_end', payload: { error: 'The API request failed.' } });
  });

  it('streams text and thinking deltas and ignores other assistant events', () => {
    const text = mapEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hi' } } as any, makeSession(), 'api-req-2');
    expect(text.message).toEqual({ type: 'stream_delta', payload: { text: 'hi' } });

    const thinking = mapEvent(
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'hm' } } as any,
      makeSession(),
      'api-req-2',
    );
    expect(thinking.message).toEqual({ type: 'stream_delta', payload: { thinking: 'hm' } });

    const other = mapEvent({ type: 'message_update', assistantMessageEvent: { type: 'tool_call' } } as any, makeSession(), 'api-req-2');
    expect(other).toEqual({ message: null, apiRequestId: 'api-req-2' });
  });

  it('folds recorded sub-agent spend into the settled header exactly once', () => {
    registerSubagentSession('settle-session', 'scout');
    recordSubagentUsage('settle-session', { turns: 2, tokensIn: 10, tokensOut: 20, cost: 0.3 });
    try {
      const first = mapEvent({ type: 'agent_settled' } as any, makeSession({ sessionId: 'settle-session' }), null);
      expect(first.message).toMatchObject({
        type: 'agent_settled',
        payload: { tokensIn: 20, tokensOut: 40, totalCost: 0.8 },
      });

      // Usage is consumed on read, so the next settle reports only the parent.
      const second = mapEvent({ type: 'agent_settled' } as any, makeSession({ sessionId: 'settle-session' }), null);
      expect(second.message).toMatchObject({ type: 'agent_settled', payload: { tokensIn: 10, tokensOut: 20, totalCost: 0.5 } });
    } finally {
      takeSubagentUsage('settle-session');
      unregisterSubagentSession('settle-session');
    }
  });

  it('replays header refreshes around compaction and maps nothing without stats', () => {
    const start = mapEvent({ type: 'compaction_start', reason: 'threshold' } as any, makeSession(), 'api-req-3');
    expect(start.message?.type).toBe('agent_start');

    const end = mapEvent(
      { type: 'compaction_end', reason: 'threshold', result: undefined, aborted: false, willRetry: false } as any,
      makeSession(),
      'api-req-3',
    );
    expect(end.message?.type).toBe('compaction_end');

    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {});
    try {
      const broken = makeSession({
        getSessionStats: () => {
          throw new Error('no stats');
        },
      });
      const result = mapEvent({ type: 'compaction_end', reason: 'manual', result: undefined, aborted: false, willRetry: false } as any, broken, null);
      expect(result).toEqual({ message: null, apiRequestId: null });
      expect(logError).toHaveBeenCalled();
    } finally {
      logError.mockRestore();
    }
  });

  it('drops unmapped events while preserving the api request id', () => {
    const result = mapEvent({ type: 'queue_update', steering: [], followUp: [] } as any, makeSession(), 'api-req-4');
    expect(result).toEqual({ message: null, apiRequestId: 'api-req-4' });
  });

  it('exposes structured tool results, todos, files, and the error flag on end', () => {
    const event = {
      type: 'tool_execution_end',
      toolCallId: 'call-9',
      isError: true,
      result: {
        content: [{ type: 'text', text: 'wrote 2 files' }],
        details: { todos: [{ content: 'x', status: 'done' }], files: [{ path: 'a.ts', content: '' }], subtitle: 'patched' },
      },
    } as any;

    expect(mapEvent(event, makeSession(), null).message).toEqual({
      type: 'tool_execution_end',
      payload: {
        id: 'call-9',
        result: 'wrote 2 files',
        todos: [{ content: 'x', status: 'done' }],
        files: [{ path: 'a.ts', content: '' }],
        subtitle: 'patched',
        is_error: true,
        subagent: undefined,
      },
    });
  });
});

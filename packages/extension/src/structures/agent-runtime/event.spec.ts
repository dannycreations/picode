import { describe, expect, it } from 'vitest';

import { registerSubagentSession, unregisterSubagentSession } from '@pi-code/extension/structures/agent-runtime/brokers/tool-call';
import { mapEvent, toolResultText } from '@pi-code/extension/structures/agent-runtime/event';

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
  it('maps tool_execution_start event with subagent info if registered', () => {
    const mockSession = {
      sessionId: 'test-session-123',
      sessionFile: 'test.json',
      model: { contextWindow: 1000 },
      getSessionStats: () => ({
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 0,
        contextUsage: { tokens: 0, contextWindow: 1000 },
      }),
    } as any;

    const mockEvent = {
      type: 'tool_execution_start' as const,
      toolCallId: 'call-1',
      toolName: 'read_file',
      args: { path: 'file.ts' },
    } as any;

    // 1. Without subagent registration
    const result1 = mapEvent(mockEvent, mockSession, null);
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
      const result2 = mapEvent(mockEvent, mockSession, null);
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
});

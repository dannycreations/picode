import { describe, expect, it } from 'vitest';

import { formatSubagentStep, lastAssistantText, recordSubagentUsage, takeSubagentUsage } from '@pi-code/extension/structures/agent-runtime/subagent';

import type { AgentSession } from '@earendil-works/pi-coding-agent';

function sessionWith(...messages: unknown[]): AgentSession {
  return { state: { messages } } as unknown as AgentSession;
}

function assistant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { role: 'assistant', content: [], stopReason: 'stop', ...overrides };
}

function textBlock(text: string): Record<string, unknown> {
  return { type: 'text', text };
}

function toolCallBlock(name = 'read_file'): Record<string, unknown> {
  return { type: 'toolCall', id: '1', name, arguments: {} };
}

describe('formatSubagentStep', () => {
  it('summarises a file read by path', () => {
    expect(formatSubagentStep('read_file', { files: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] })).toBe('read src/a.ts, src/b.ts');
  });

  it('handles a read without usable paths', () => {
    expect(formatSubagentStep('read_file', { files: [{}] })).toBe('read (no path)');
  });

  it('summarises a command and collapses whitespace', () => {
    expect(formatSubagentStep('execute_command', { command: 'rg  "foo"\n  --hidden' })).toBe('execute rg "foo" --hidden');
  });

  it('does not crash and shows no path when read_file files is not an array', () => {
    expect(() => formatSubagentStep('read_file', { files: { path: 'src/a.ts' } })).not.toThrow();
    expect(formatSubagentStep('read_file', { files: { path: 'src/a.ts' } })).toBe('read (no path)');
    expect(formatSubagentStep('read_file', { files: 'src/a.ts' })).toBe('read (no path)');
    expect(formatSubagentStep('read_file', {})).toBe('read (no path)');
    expect(formatSubagentStep('read_file', undefined)).toBe('read (no path)');
  });
});

describe('subagent usage accumulation', () => {
  it('sums per-session child usage and clears on read', () => {
    recordSubagentUsage('s1', { turns: 1, tokensIn: 10, tokensOut: 5, cost: 0.01 });
    recordSubagentUsage('s1', { turns: 2, tokensIn: 20, tokensOut: 8, cost: 0.02 });

    expect(takeSubagentUsage('s1')).toEqual({ turns: 3, tokensIn: 30, tokensOut: 13, cost: 0.03 });
    expect(takeSubagentUsage('s1')).toEqual({ turns: 0, tokensIn: 0, tokensOut: 0, cost: 0 });
  });

  it('keeps sessions isolated', () => {
    recordSubagentUsage('a', { turns: 1, tokensIn: 1, tokensOut: 1, cost: 0.001 });

    expect(takeSubagentUsage('b')).toEqual({ turns: 0, tokensIn: 0, tokensOut: 0, cost: 0 });
    expect(takeSubagentUsage('a')).toEqual({ turns: 1, tokensIn: 1, tokensOut: 1, cost: 0.001 });
  });
});

describe('lastAssistantText', () => {
  it('returns the trimmed text of the last assistant message', () => {
    const session = sessionWith(assistant({ content: [textBlock('   final report   ')] }));

    expect(lastAssistantText(session)).toEqual({ text: 'final report' });
  });

  it('walks back to the last assistant message past tool results', () => {
    const session = sessionWith({ role: 'toolResult', content: [] }, assistant({ content: [textBlock('answer')] }));

    expect(lastAssistantText(session)).toEqual({ text: 'answer' });
  });

  it('names a tool-call ending by stop reason', () => {
    const session = sessionWith(assistant({ content: [toolCallBlock()], stopReason: 'toolUse' }));

    expect(lastAssistantText(session).error).toBe('The sub-agent ended without a report; its last turn was a tool call.');
  });

  it('names a tool-call ending when the last turn is a tool call after a tool result', () => {
    const session = sessionWith(
      assistant({ content: [textBlock('partial')] }),
      { role: 'toolResult', content: [] },
      assistant({ content: [toolCallBlock('read_file')], stopReason: 'toolUse' }),
    );

    const result = lastAssistantText(session);
    expect(result.text).toBe('');
    expect(result.error).toBe('The sub-agent ended without a report; its last turn was a tool call.');
  });

  it('reports a generic empty report when text is missing without a tool call', () => {
    const session = sessionWith(assistant({ content: [], stopReason: 'length' }));

    expect(lastAssistantText(session).error).toBe('The sub-agent ended without a report.');
  });

  it('surfaces the error message when the run failed', () => {
    const session = sessionWith(assistant({ content: [], stopReason: 'error', errorMessage: 'context window exceeded' }));

    expect(lastAssistantText(session).error).toBe('context window exceeded');
  });

  it('falls back to a generic failure message when the error has no detail', () => {
    const session = sessionWith(assistant({ content: [], stopReason: 'error' }));

    expect(lastAssistantText(session).error).toBe('The sub-agent request failed.');
  });

  it('reports no report when there are no assistant messages', () => {
    const session = sessionWith({ role: 'user', content: 'hi' });

    expect(lastAssistantText(session)).toEqual({
      text: '',
      error: 'The sub-agent produced no report.',
    });
  });
});

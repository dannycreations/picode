import { describe, expect, it } from 'vitest';

import {
  describeSubagents,
  formatSubagentStep,
  getSubagent,
  recordSubagentUsage,
  SUBAGENTS,
  takeSubagentUsage,
} from '@pi-code/extension/structures/agent-runtime/subagent';

describe('subagent catalog', () => {
  it('grants only read-only tools', () => {
    for (const agent of SUBAGENTS) {
      expect(agent.tools.length, agent.name).toBeGreaterThan(0);
      for (const tool of agent.tools) {
        expect(['read_file', 'execute_command'], agent.name).toContain(tool);
      }
    }
  });

  it('describes every sub-agent for the tool description', () => {
    const described = describeSubagents();

    for (const agent of SUBAGENTS) {
      expect(described).toContain(agent.name);
      expect(described).toContain(agent.summary);
      expect(agent.prompt.trim(), agent.name).not.toBe('');
    }
  });

  it('resolves known names and rejects unknown ones', () => {
    expect(getSubagent('explore')?.name).toBe('explore');
    expect(getSubagent('nope')).toBeUndefined();
  });
});

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

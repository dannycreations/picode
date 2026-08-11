import { describe, expect, it } from 'vitest';

import {
  describeSubagents,
  formatSubagentStep,
  getSubagent,
  recordSubagentUsage,
  SUBAGENT_NAMES,
  SUBAGENTS,
  takeSubagentUsage,
} from '@pi-code/extension/structures/agent-runtime/subagent';

describe('subagent catalog', () => {
  it('exposes a unique name for every sub-agent', () => {
    expect([...SUBAGENT_NAMES].sort()).toEqual([...new Set(SUBAGENT_NAMES)].sort());
    expect(SUBAGENT_NAMES).toEqual(SUBAGENTS.map((agent) => agent.name));
  });

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
    expect(formatSubagentStep('execute_command', { command: 'rg  "foo"\n  --hidden' })).toBe('$ rg "foo" --hidden');
  });

  it('truncates a long argument preview', () => {
    const step = formatSubagentStep('execute_command', { command: 'a'.repeat(200) });

    expect(step.endsWith('…')).toBe(true);
    expect(step.length).toBeLessThan(100);
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

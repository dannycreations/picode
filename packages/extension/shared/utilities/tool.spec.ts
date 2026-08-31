import { describe, expect, it } from 'vitest';

import { buildToolSections, getDiffStat, getFirstDiffLine, getToolHeaderMeta, GROUP_TOOLS } from '@pi-code/shared/utilities/tool';

import type { ChatMessage, ToolChatMessage } from '@pi-code/shared/core/types';

function mcpMessage(patch: Partial<ToolChatMessage>): ChatMessage {
  return { id: 't1', sender: 'tool', text: 'mcp', timestamp: 1_700_000_000_000, ...patch };
}

describe('buildToolSections mcp', () => {
  it('titles a server catalog call', () => {
    const [section] = buildToolSections(mcpMessage({ toolName: 'mcp', toolStatus: 'running' }));
    expect(section.title).toBe('List servers');
    expect(section.content).toBeUndefined();
  });

  it('titles a tool listing call', () => {
    const [section] = buildToolSections(mcpMessage({ toolName: 'mcp', toolStatus: 'completed', toolArgs: { server: 'searxng' } }));
    expect(section.title).toBe('searxng: list tools');
  });

  it('shows pending arguments while awaiting approval', () => {
    const args = { query: 'pi code' };
    const [section] = buildToolSections(
      mcpMessage({
        toolName: 'mcp',
        toolStatus: 'approval',
        toolArgs: { server: 'searxng', tool: 'search', arguments: args },
      }),
    );
    expect(section.title).toBe('searxng: search');
    expect(section.content).toBe(JSON.stringify(args, null, 2));
    expect(section.language).toBe('json');
  });

  it('shows the result once completed and keeps the outcome subtitle', () => {
    const [section] = buildToolSections(
      mcpMessage({
        toolName: 'mcp',
        toolStatus: 'completed',
        toolArgs: { server: 'searxng', tool: 'search', arguments: { query: 'pi code' } },
        diff: '- result -',
        subtitle: 'searxng/search',
      }),
    );
    expect(section.content).toBe('- result -');
    expect(section.subtitle).toBe('searxng/search');
    expect(section.language).toBe('text');
  });

  it('groups consecutive calls like other section-rendered tools', () => {
    expect(GROUP_TOOLS.has('mcp')).toBe(true);
  });
});

describe('getToolHeaderMeta mcp', () => {
  it('labels each status', () => {
    expect(getToolHeaderMeta('mcp')).toEqual({ title: 'Called MCP', icon: 'plug' });
    expect(getToolHeaderMeta('mcp', 'running').title).toBe('Calling MCP');
    expect(getToolHeaderMeta('mcp', 'approval').title).toBe('Wants to call MCP');
    expect(getToolHeaderMeta('mcp', 'denied').title).toBe('MCP call denied');
  });
});

describe('getFirstDiffLine', () => {
  it('returns the line number of the first added line', () => {
    const diff = [' 360 pub fn old() {}', '+367 // inserted comment', '+368 fn new_fn() {}', ' 385 pub fn flatten() {}'].join('\n');
    expect(getFirstDiffLine(diff)).toBe(367);
  });

  it('returns the line number when the first change is a removal', () => {
    const diff = ['-360 let removed = true;', ' 361 let kept = false;'].join('\n');
    expect(getFirstDiffLine(diff)).toBe(360);
  });

  it('parses padded line numbers', () => {
    const diff = [' 360 pub fn old() {}', '+  5 let tiny = 0;'].join('\n');
    expect(getFirstDiffLine(diff)).toBe(5);
  });

  it('ignores leading context lines before the first change', () => {
    const diff = [' 1 first', ' 2 second', '+3 inserted', ' 4 fourth'].join('\n');
    expect(getFirstDiffLine(diff)).toBe(3);
  });

  it('returns undefined when there is no change', () => {
    const diff = [' 1 a', ' 2 b'].join('\n');
    expect(getFirstDiffLine(diff)).toBeUndefined();
  });

  it('returns undefined for empty or missing diff', () => {
    expect(getFirstDiffLine('')).toBeUndefined();
    expect(getFirstDiffLine(undefined)).toBeUndefined();
  });
});

describe('getDiffStat', () => {
  it('counts additions and removals in the edit_file diff format', () => {
    const diff = [' 360 pub fn old() {}', '+367 // inserted', '-360 let removed = true;', ' 361 let kept = false;'].join('\n');
    expect(getDiffStat(diff)).toEqual({ added: 1, removed: 1 });
  });

  it('returns undefined when there is no change', () => {
    const diff = [' 1 first', ' 2 second'].join('\n');
    expect(getDiffStat(diff)).toBeUndefined();
  });

  it('ignores unified-diff file markers', () => {
    const diff = '--- a/file.ts\n+++ b/file.ts\n+added line\n-removed line';
    expect(getDiffStat(diff)).toEqual({ added: 1, removed: 1 });
  });

  it('returns undefined for empty or missing diff', () => {
    expect(getDiffStat('')).toBeUndefined();
    expect(getDiffStat(undefined)).toBeUndefined();
  });
});

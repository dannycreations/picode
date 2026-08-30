import { describe, expect, it } from 'vitest';

import { extractPathPatterns, getToolPatternConfig } from '@pi-code/webview/components/chat/helpers/tool-pattern';

import type { AppSettings } from '@pi-code/shared/core/settings';
import type { ToolArguments, ToolChatMessage, ToolName } from '@pi-code/shared/core/types';

function makeMessage(toolName: ToolName, toolArgs?: ToolArguments, overrides: Partial<ToolChatMessage> = {}): ToolChatMessage {
  return {
    id: 'm',
    text: 'x',
    timestamp: 0,
    sender: 'tool',
    toolName,
    toolArgs,
    ...overrides,
  } as ToolChatMessage;
}

describe('extractPathPatterns', () => {
  it('returns the exact path and a directory glob', () => {
    expect(extractPathPatterns('src/foo/bar.ts')).toEqual(['src/foo/bar.ts', 'src/foo/**']);
  });

  it('normalizes windows separators and a trailing slash', () => {
    expect(extractPathPatterns('a\\b\\c.ts/')).toEqual(['a/b/c.ts', 'a/b/**']);
  });

  it('returns only the file when there is no parent directory', () => {
    expect(extractPathPatterns('foo.ts')).toEqual(['foo.ts']);
  });

  it('returns nothing for blank input', () => {
    expect(extractPathPatterns('')).toEqual([]);
    expect(extractPathPatterns('   ')).toEqual([]);
  });
});

describe('getToolPatternConfig', () => {
  it('returns null for tools without an approval list', () => {
    expect(getToolPatternConfig(makeMessage('mcp', {}), null)).toBeNull();
  });

  it('returns null when execute_command has no command', () => {
    expect(getToolPatternConfig(makeMessage('execute_command', {}), null)).toBeNull();
  });

  it('derives command patterns and keys for execute_command', () => {
    const config = getToolPatternConfig(makeMessage('execute_command', { command: 'git status' }), null);
    expect(config?.patterns).toEqual(['git status', 'git']);
    expect(config?.allowKey).toBe('allowedExecuteCommands');
    expect(config?.denyKey).toBe('deniedExecuteCommands');
  });

  it('derives path patterns for write_file and reflects current settings', () => {
    const config = getToolPatternConfig(makeMessage('write_file', { path: 'src/a.ts', content: '' }), {
      allowedWritePaths: ['src/a.ts'],
    } as unknown as AppSettings);
    expect(config?.patterns).toEqual(['src/a.ts', 'src/**']);
    expect(config?.allowedPatterns).toEqual(['src/a.ts']);
    expect(config?.allowKey).toBe('allowedWritePaths');
  });

  it('derives paths from message.files for read_file', () => {
    const config = getToolPatternConfig(makeMessage('read_file', undefined, { files: [{ path: 'docs/readme.md', content: '' }] }), null);
    expect(config?.patterns).toEqual(['docs/readme.md', 'docs/**']);
    expect(config?.allowKey).toBe('allowedReadPaths');
  });

  it('returns null for delete_file with no path', () => {
    expect(getToolPatternConfig(makeMessage('delete_file', {}), null)).toBeNull();
  });

  it('merges command patterns from every stacked call, not only the last', () => {
    const stacked = makeMessage(
      'execute_command',
      { command: 'git push' },
      {
        toolSections: [
          { id: 'c1', title: 'git status', language: 'shell' },
          { id: 'c2', title: 'git pull', language: 'shell' },
          { id: 'c3', title: 'git push', language: 'shell' },
        ],
      },
    );

    const config = getToolPatternConfig(stacked, null);

    expect(config?.patterns).toEqual(['git push', 'git', 'git status', 'git pull']);
  });

  it('merges path patterns from every stacked file call', () => {
    const stacked = makeMessage(
      'write_file',
      { path: 'src/c.ts', content: '' },
      {
        toolSections: [
          { id: 'w1', title: 'src/a.ts', openPath: 'src/a.ts' },
          { id: 'w2', title: 'src/b.ts', openPath: 'src/b.ts' },
        ],
      },
    );

    const config = getToolPatternConfig(stacked, null);

    expect(config?.patterns).toEqual(['src/c.ts', 'src/**', 'src/a.ts', 'src/b.ts']);
  });
});

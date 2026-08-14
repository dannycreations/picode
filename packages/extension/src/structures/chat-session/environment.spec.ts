import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildFileTree,
  getEnvironmentDetails,
  hasReminders,
  renderFileTree,
  walkWorkspace,
} from '@pi-code/extension/structures/chat-session/environment';
import { formatTodoReminder, getLatestTodoList, withTodoProgress } from './environment';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

const hoisted = vi.hoisted(() => ({
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  readDirectory: vi.fn(),
  readFile: vi.fn(),
  getGitRepository: vi.fn(),
  getIgnoredPaths: vi.fn(),
  mockSettings: {
    maxWorkspaceFiles: 3,
    excludeIgnoredFiles: false,
    maxOpenTabsContext: 0,
    maxGitStatusFiles: 0,
    enableTodoTool: false,
  },
}));

const { FileType, readDirectory, readFile, getGitRepository, getIgnoredPaths } = hoisted;

vi.mock('vscode', () => {
  const Uri = {
    file: (path: string) => ({ fsPath: path.replace(/\\/g, '/'), path, toString: () => path }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/').replace(/\/+/g, '/'),
    }),
  };
  return {
    FileType: hoisted.FileType,
    Uri,
    workspace: {
      fs: {
        readDirectory: hoisted.readDirectory,
        readFile: hoisted.readFile,
      },
      asRelativePath: (uri: { fsPath: string }) => {
        const fsPath = uri.fsPath;
        if (fsPath.startsWith('/workspace/')) return fsPath.replace('/workspace/', '');
        return fsPath;
      },
      getWorkspaceFolder: () => ({}),
    },
    window: { visibleTextEditors: [], tabGroups: { all: [] } },
    TabInputText: class {},
  };
});

vi.mock('@pi-code/extension/utilities/git', () => ({
  getGitRepository: (...args: unknown[]) => hoisted.getGitRepository(...args),
  getIgnoredPaths: (...args: unknown[]) => hoisted.getIgnoredPaths(...args),
}));

vi.mock('@pi-code/extension/core/settings', () => ({
  readAppSettings: () => hoisted.mockSettings,
}));

beforeEach(() => {
  readDirectory.mockReset();
  readFile.mockReset();
  getGitRepository.mockResolvedValue(null);
  getIgnoredPaths.mockResolvedValue(new Set());
});

describe('renderFileTree', () => {
  it('renders a compact indented tree without repeating parent path segments', () => {
    const paths = ['src/', 'src/a.ts', 'src/sub/', 'src/sub/b.ts', 'readme.md'];
    const out = renderFileTree(buildFileTree(paths), 'root');

    expect(out).toBe(['root', '├─ src/', '│  ├─ sub/', '│  │  └─ b.ts', '│  └─ a.ts', '└─ readme.md'].join('\n'));
  });

  it('treats trailing-slash entries as directories', () => {
    const tree = buildFileTree(['dist/', 'dist/app.js']);
    const out = renderFileTree(tree, 'root');

    expect(out).toBe(['root', '└─ dist/', '   └─ app.js'].join('\n'));
  });

  it('correctly identifies intermediate folders as directories even if not explicitly listed with a trailing slash', () => {
    const paths = ['src/a.ts', 'src/sub/b.ts', 'readme.md'];
    const tree = buildFileTree(paths);
    const out = renderFileTree(tree, 'root');

    expect(out).toBe(['root', '├─ src/', '│  ├─ sub/', '│  │  └─ b.ts', '│  └─ a.ts', '└─ readme.md'].join('\n'));
  });

  it('renders a folder with a single nested file', () => {
    const out = renderFileTree(buildFileTree(['src/', 'src/a.ts']), 'root');

    expect(out).toBe(['root', '└─ src/', '   └─ a.ts'].join('\n'));
  });
});

describe('getEnvironmentDetails workspace files listing', () => {
  it('sorts files alphabetically before slicing to the settings limit', async () => {
    readDirectory.mockImplementation(async (uri: { fsPath: string }) => {
      if (uri.fsPath === '/workspace')
        return [
          ['webview', FileType.Directory],
          ['shared', FileType.Directory],
          ['extension', FileType.Directory],
        ];
      if (uri.fsPath === '/workspace/webview')
        return [
          ['index.html', FileType.File],
          ['style.css', FileType.File],
        ];
      if (uri.fsPath === '/workspace/shared') return [['utils.ts', FileType.File]];
      if (uri.fsPath === '/workspace/extension') return [['main.ts', FileType.File]];
      return [];
    });

    const details = await getEnvironmentDetails('/workspace', true);

    // After natural sort the first three (of four) files are shown; style.css is sliced off.
    expect(details).toContain('extension/');
    expect(details).toContain('main.ts');
    expect(details).toContain('shared/');
    expect(details).toContain('utils.ts');
    expect(details).toContain('webview/');
    expect(details).toContain('index.html');
    expect(details).not.toContain('style.css');
    expect(details).toContain('File list truncated');
  });
});

describe('walkWorkspace', () => {
  it('reads each directory exactly once (true cursor, no rescan)', async () => {
    readDirectory.mockImplementation(async (uri: { fsPath: string }) => {
      if (uri.fsPath === '/')
        return [
          ['a', FileType.Directory],
          ['b', FileType.Directory],
          ['f1.ts', FileType.File],
          ['f2.ts', FileType.File],
        ];
      if (uri.fsPath === '/a') return [['a1.ts', FileType.File]];
      if (uri.fsPath === '/b') return [['b1.ts', FileType.File]];
      return [];
    });

    const { paths } = await walkWorkspace('/', 100, false);

    expect([...paths].sort()).toEqual(['a/a1.ts', 'b/b1.ts', 'f1.ts', 'f2.ts']);
    // Root plus the two subdirectories, each read a single time.
    const calledDirs = readDirectory.mock.calls.map((c) => c[0].fsPath).sort();
    expect(calledDirs).toEqual(['/', '/a', '/b']);
  });

  it('skips gitignored directories instead of descending into them', async () => {
    readDirectory.mockImplementation(async (uri: { fsPath: string }) => {
      if (uri.fsPath === '/')
        return [
          ['src', FileType.Directory],
          ['node_modules', FileType.Directory],
          ['README.md', FileType.File],
        ];
      if (uri.fsPath === '/src') return [['index.ts', FileType.File]];
      if (uri.fsPath === '/node_modules') return [['x.js', FileType.File]];
      return [];
    });
    getGitRepository.mockResolvedValue({});
    getIgnoredPaths.mockImplementation(async (_repo: unknown, paths: string[]) => new Set(paths.filter((p) => p.includes('node_modules'))));

    const { paths } = await walkWorkspace('/', 100, true);

    expect([...paths].sort()).toEqual(['README.md', 'src/index.ts']);
    const calledDirs = readDirectory.mock.calls.map((c) => c[0].fsPath);
    expect(calledDirs).not.toContain('/node_modules');
  });

  it('skips npm-ignored files/dirs in a non-git workspace using fallback .gitignore parsing', async () => {
    readDirectory.mockImplementation(async (uri: { fsPath: string }) => {
      if (uri.fsPath === '/') {
        return [
          ['.gitignore', FileType.File],
          ['src', FileType.Directory],
          ['node_modules', FileType.Directory],
          ['build', FileType.Directory],
          ['README.md', FileType.File],
          ['error.log', FileType.File],
        ];
      }
      if (uri.fsPath === '/src') {
        return [
          ['.gitignore', FileType.File],
          ['index.ts', FileType.File],
          ['build', FileType.Directory],
        ];
      }
      if (uri.fsPath === '/src/build') {
        return [['main.js', FileType.File]];
      }
      if (uri.fsPath === '/build') {
        return [['root-build.ts', FileType.File]];
      }
      if (uri.fsPath === '/node_modules') {
        return [['x.js', FileType.File]];
      }
      return [];
    });

    readFile.mockImplementation(async (uri: { fsPath: string }) => {
      if (uri.fsPath === '/.gitignore') {
        return new TextEncoder().encode('node_modules/\n*.log');
      }
      if (uri.fsPath === '/src/.gitignore') {
        return new TextEncoder().encode('/build/');
      }
      throw new Error('Not found');
    });

    getGitRepository.mockResolvedValue(null);

    const { paths } = await walkWorkspace('/', 100, true);

    expect([...paths].sort()).toEqual(['.gitignore', 'README.md', 'build/root-build.ts', 'src/.gitignore', 'src/index.ts']);
    const calledDirs = readDirectory.mock.calls.map((c) => c[0].fsPath);
    expect(calledDirs).not.toContain('/node_modules');
    expect(calledDirs).not.toContain('/src/build');
    expect(calledDirs).toContain('/build');
  });

  it('stops at the limit and reports hitLimit accurately', async () => {
    readDirectory.mockResolvedValue([
      ['f1.ts', FileType.File],
      ['f2.ts', FileType.File],
      ['f3.ts', FileType.File],
      ['f4.ts', FileType.File],
      ['f5.ts', FileType.File],
    ]);

    const capped = await walkWorkspace('/', 3, false);
    expect(capped.paths).toEqual(['f1.ts', 'f2.ts', 'f3.ts']);
    expect(capped.paths).toHaveLength(3);
    expect(capped.hitLimit).toBe(true);

    const under = await walkWorkspace('/', 10, false);
    expect(under.paths).toHaveLength(5);
    expect(under.hitLimit).toBe(false);
  });

  it('sorts naturally so 9-a precedes 10-a', async () => {
    readDirectory.mockResolvedValue([
      ['10-a.ts', FileType.File],
      ['9-a.ts', FileType.File],
      ['2-b.ts', FileType.File],
    ]);

    const { paths } = await walkWorkspace('/', 10, false);

    expect(paths).toEqual(['2-b.ts', '9-a.ts', '10-a.ts']);
  });
});

const todos: TodoItem[] = [
  { content: 'a', status: 'completed' },
  { content: 'b', status: 'progress' },
];

describe('formatTodoReminder', () => {
  it('gives a creation hint when no list exists', () => {
    expect(formatTodoReminder(undefined)).toContain('`update_todo`');
    expect(formatTodoReminder([])).toContain('`update_todo`');
  });

  it('renders the current checklist with a status-update nudge', () => {
    const out = formatTodoReminder(todos);
    expect(out).toContain('| 1 | a | Completed |');
    expect(out).toContain('| 2 | b | In Progress |');
    expect(out).toContain('call the `update_todo` tool');
  });
});

describe('getLatestTodoList', () => {
  it('returns the most recent update_todo result from history', () => {
    const messages: AgentMessage[] = [
      {
        role: 'toolResult',
        toolCallId: '1',
        toolName: 'update_todo',
        content: [],
        details: { todos: [{ content: 'old', status: 'pending' }] },
        isError: false,
        timestamp: 0,
      },
      { role: 'toolResult', toolCallId: '2', toolName: 'read_file', content: [], details: {}, isError: false, timestamp: 0 },
      { role: 'toolResult', toolCallId: '3', toolName: 'update_todo', content: [], details: { todos: todos }, isError: false, timestamp: 0 },
    ];
    expect(getLatestTodoList(messages)).toEqual(todos);
  });

  it('returns undefined when no update_todo result exists', () => {
    expect(getLatestTodoList([{ role: 'user', content: 'hi', timestamp: 0 }])).toBeUndefined();
  });
});

describe('withTodoProgress', () => {
  const base: AgentMessage[] = [
    { role: 'user', content: 'hello', timestamp: 0 },
    { role: 'user', content: 'ok', timestamp: 0 },
  ];

  it('appends exactly one reminder and leaves other history intact', () => {
    const out = withTodoProgress(base, todos);
    expect(out.length).toBe(base.length + 1);
    expect(out.filter(hasReminders)).toHaveLength(1);
  });

  it('replaces the previous reminder instead of accumulating across turns', () => {
    const once = withTodoProgress(base, todos);
    const twice = withTodoProgress(once, todos);
    expect(twice.filter(hasReminders)).toHaveLength(1);
    expect(twice.length).toBe(base.length + 1);
  });

  it('does not mutate the input array', () => {
    const out = withTodoProgress(base, todos);
    expect(out).not.toBe(base);
    expect(base).toHaveLength(2);
  });
});

import { describe, expect, it, vi } from 'vitest';

import { buildFileTree, getEnvironmentDetails, hasReminders, renderFileTree } from '@pi-code/extension/structures/chat-session/environment';
import { formatTodoReminder, getLatestTodoList, withTodoProgress } from './environment';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

vi.mock('vscode', () => {
  const Uri = {
    file: (path: string) => ({
      fsPath: path,
      path,
      toString: () => path,
    }),
  };
  return {
    RelativePattern: class {
      constructor(
        public base: string,
        public pattern: string,
      ) {}
    },
    Uri,
    workspace: {
      findFiles: vi.fn(),
      asRelativePath: (uri: any) => {
        const fsPath = uri.fsPath;
        if (fsPath.startsWith('/workspace/')) {
          return fsPath.replace('/workspace/', '');
        }
        return fsPath;
      },
      getWorkspaceFolder: () => ({}),
    },
    window: {
      visibleTextEditors: [],
      tabGroups: {
        all: [],
      },
    },
    TabInputText: class {},
  };
});

vi.mock('@pi-code/extension/core/settings', () => {
  return {
    readAppSettings: () => ({
      maxWorkspaceFiles: 3,
      excludeIgnoredFiles: false,
      maxOpenTabsContext: 0,
      maxGitStatusFiles: 0,
      enableTodoTool: false,
    }),
  };
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
});

describe('getEnvironmentDetails workspace files listing', () => {
  it('sorts files alphabetically before slicing to settings limit', async () => {
    const { workspace, Uri } = await import('vscode');
    const mockFindFiles = workspace.findFiles as any;

    // Return unsorted files
    mockFindFiles.mockResolvedValue([
      Uri.file('/workspace/webview/index.html'),
      Uri.file('/workspace/shared/utils.ts'),
      Uri.file('/workspace/extension/main.ts'),
      Uri.file('/workspace/webview/style.css'),
    ]);

    const details = await getEnvironmentDetails('/workspace', true);

    // The limit is 3, so after alphabetical sorting:
    // 1. extension/main.ts
    // 2. shared/utils.ts
    // 3. webview/index.html
    // (webview/style.css is sliced out)

    expect(details).toContain('workspace'); // root label
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

const todos: TodoItem[] = [
  { content: 'a', status: 'completed' },
  { content: 'b', status: 'in_progress' },
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

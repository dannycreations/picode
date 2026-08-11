import { describe, expect, it, vi } from 'vitest';

import { buildFileTree, getEnvironmentDetails, renderFileTree } from '@pi-code/extension/structures/chat-session/environment';

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

    const dummySession = { messages: [] } as any;
    const details = await getEnvironmentDetails(dummySession, '/workspace', true);

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

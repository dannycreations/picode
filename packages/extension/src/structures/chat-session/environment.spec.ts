import { describe, expect, it } from 'vitest';

import { buildFileTree, renderFileTree } from '@pi-code/extension/structures/chat-session/environment';

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
});

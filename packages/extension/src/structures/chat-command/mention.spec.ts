import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expandMentions } from '@pi-code/extension/structures/chat-command/mention';
import { resolveCommitTag } from '@pi-code/extension/utilities/commit';

// expandMentions reads its truncation budget from app settings, which depend on
// the VS Code API. Stub just that one function so the logic can run in isolation.
vi.mock('@pi-code/extension/core/settings', () => ({
  readOutputLimits: () => ({ maxLines: 2000, maxBytes: 512 * 1024 }),
}));

// Git history is an external process; the tag routing is what is under test here.
vi.mock('@pi-code/extension/utilities/commit', () => ({ resolveCommitTag: vi.fn() }));

const resolveCommitTagMock = vi.mocked(resolveCommitTag);

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'pi-mention-'));
  resolveCommitTagMock.mockReset().mockResolvedValue(null);
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = join(cwd, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, content);
}

describe('expandMentions', () => {
  it('leaves unrelated text such as emails and missing paths untouched', async () => {
    const mentionContent = await expandMentions('contact a@b about @does-not-exist please', cwd);
    expect(mentionContent).toBe('');
  });

  it('moves file content to the mention channel', async () => {
    await write('.gitignore', 'secret.txt\n');
    await write('secret.txt', 'hidden treasure');
    await write('readme.md', 'project docs');

    const mentionContent = await expandMentions('Review @secret.txt and @readme.md', cwd);

    // The file bodies go to the hidden channel the model reads instead.
    expect(mentionContent).toContain('## File Content: secret.txt');
    expect(mentionContent).toContain('hidden treasure');
    expect(mentionContent).toContain('## File Content: readme.md');
    expect(mentionContent).toContain('project docs');
  });

  it('expands an existing folder into a markdown block listing only entry names', async () => {
    await write('src/index.ts', 'console.log(1)');
    await write('src/util.ts', 'export const x = 2');

    const mentionContent = await expandMentions('Look at @src', cwd);

    expect(mentionContent).toContain('## Folder Content: src');
    expect(mentionContent).toContain('├─ index.ts');
    expect(mentionContent).toContain('└─ util.ts');
    // File contents are not inlined; only the entry names are listed as a tree.
    expect(mentionContent).not.toContain('console.log(1)');
    expect(mentionContent).not.toContain('export const x = 2');
  });

  it('excludes .git internals from a mentioned folder, matching the environment walk', async () => {
    await write('project/src/index.ts', 'console.log(1)');
    await write('project/.git/config', 'core.filemode=true');

    const mentionContent = await expandMentions('Look at @project', cwd);

    expect(mentionContent).toContain('## Folder Content: project');
    expect(mentionContent).toContain('└─ index.ts');
    // The .git directory must stay out of the listing entirely.
    expect(mentionContent).not.toContain('.git');
    expect(mentionContent).not.toContain('core.filemode=true');
  });

  it('deduplicates repeated mentions into a single block', async () => {
    await write('dup.ts', 'same content');

    const mentionContent = await expandMentions('@dup.ts then @dup.ts', cwd);

    expect(mentionContent.match(/## File Content: dup\.ts/g)).toHaveLength(1);
  });

  it('leaves ordinary #words such as issue references and headings untouched', async () => {
    const mentionContent = await expandMentions('fix #12345 and keep the # Heading intact', cwd);

    expect(mentionContent).toBe('');
  });

  it('expands #changes through the git resolver', async () => {
    resolveCommitTagMock.mockResolvedValue('## Working Changes\n\nM src/a.ts');

    const mentionContent = await expandMentions('check #changes please', cwd);

    expect(resolveCommitTagMock).toHaveBeenCalledWith('changes', cwd, { maxLines: 2000, maxBytes: 512 * 1024 });
    expect(mentionContent).toBe('## Working Changes\n\nM src/a.ts');
  });

  it('places commit blocks after file blocks in the mention channel', async () => {
    await write('secret.txt', 'hidden treasure');
    resolveCommitTagMock.mockResolvedValue('COMMIT BLOCK');

    const mentionContent = await expandMentions('compare @secret.txt with #abc1234', cwd);

    const fileAt = mentionContent.indexOf('## File Content: secret.txt');
    const commitAt = mentionContent.indexOf('COMMIT BLOCK');
    expect(fileAt).toBeGreaterThanOrEqual(0);
    expect(commitAt).toBeGreaterThan(fileAt);
  });
});

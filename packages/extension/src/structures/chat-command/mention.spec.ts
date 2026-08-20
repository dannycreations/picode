import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expandMentions, toMentionText } from './mention';

// expandMentions reads output limits from app settings, which depend on the
// VS Code API. Stub just that one function so the logic can run in isolation.
vi.mock('@pi-code/extension/core/settings', () => ({
  readAppSettings: () =>
    ({
      maxToolOutputLines: 2000,
      maxToolOutputSizeKb: 512,
    }) as unknown as import('@pi-code/shared/core/settings').AppSettings,
}));

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'pi-mention-'));
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
    const text = 'contact a@b about @does-not-exist please';
    const result = await expandMentions(text, cwd);
    expect(result.text).toBe(text);
    expect(result.mentionContent).toBe('');
  });

  it('keeps the original @tokens in the prompt and moves file content to mentionContent', async () => {
    await write('.gitignore', 'secret.txt\n');
    await write('secret.txt', 'hidden treasure');
    await write('readme.md', 'project docs');

    const result = await expandMentions('Review @secret.txt and @readme.md', cwd);

    // The visible prompt keeps the tokens, nothing about the file is inlined.
    expect(result.text).toBe('Review @secret.txt and @readme.md');
    // The file bodies go to the hidden channel the model reads instead.
    expect(result.mentionContent).toContain('<file_content path="secret.txt">');
    expect(result.mentionContent).toContain('hidden treasure');
    expect(result.mentionContent).toContain('<file_content path="readme.md">');
    expect(result.mentionContent).toContain('project docs');
    expect(result.text).not.toContain('<file_content');
  });

  it('expands an existing folder into a folder_content block listing only entry names', async () => {
    await write('src/index.ts', 'console.log(1)');
    await write('src/util.ts', 'export const x = 2');

    const result = await expandMentions('Look at @src', cwd);

    expect(result.mentionContent).toContain('<folder_content path="src">');
    expect(result.mentionContent).toContain('src/index.ts');
    expect(result.mentionContent).toContain('src/util.ts');
    // File contents are not inlined; only the entry names are listed.
    expect(result.mentionContent).not.toContain('console.log(1)');
    expect(result.mentionContent).not.toContain('export const x = 2');
  });

  it('excludes .git internals from a mentioned folder, matching the environment walk', async () => {
    await write('project/src/index.ts', 'console.log(1)');
    await write('project/.git/config', 'core.filemode=true');

    const result = await expandMentions('Look at @project', cwd);

    expect(result.mentionContent).toContain('<folder_content path="project">');
    expect(result.mentionContent).toContain('project/src/index.ts');
    // The .git directory must stay out of the listing entirely.
    expect(result.mentionContent).not.toContain('.git');
    expect(result.mentionContent).not.toContain('core.filemode=true');
  });

  it('deduplicates repeated mentions into a single block', async () => {
    await write('dup.ts', 'same content');

    const result = await expandMentions('@dup.ts then @dup.ts', cwd);

    expect(result.mentionContent.match(/<file_content path="dup.ts">/g)).toHaveLength(1);
  });
});

describe('toMentionText', () => {
  it('turns a dropped workspace path into a relative @mention', () => {
    expect(toMentionText(join(cwd, 'secret.txt'), cwd)).toBe('@secret.txt');
  });

  it('falls back to the absolute path for files outside the workspace', () => {
    const outside = join(tmpdir(), 'outside.txt');
    const mention = toMentionText(outside, cwd);
    expect(mention.startsWith('@')).toBe(true);
    expect(mention).toContain('outside.txt');
  });
});

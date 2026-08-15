import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expandMentions } from './mention';

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
    expect(await expandMentions(text, cwd)).toBe(text);
  });

  it('expands an existing file into a file_content block, including gitignored files', async () => {
    await write('.gitignore', 'secret.txt\n');
    await write('secret.txt', 'hidden treasure');
    await write('readme.md', 'project docs');

    const result = await expandMentions('Review @secret.txt and @readme.md', cwd);

    expect(result).toContain('<file_content path="secret.txt">');
    expect(result).toContain('hidden treasure');
    expect(result).toContain('<file_content path="readme.md">');
    expect(result).toContain('project docs');
    // The raw token is replaced, not left inline.
    expect(result).not.toContain('@secret.txt');
  });

  it('expands an existing folder into a folder_content block', async () => {
    await write('src/index.ts', 'console.log(1)');
    await write('src/util.ts', 'export const x = 2');

    const result = await expandMentions('Look at @src', cwd);

    expect(result).toContain('<folder_content path="src">');
    expect(result).toContain('<file path="src/index.ts">');
    expect(result).toContain('<file path="src/util.ts">');
  });

  it('deduplicates repeated mentions into a single block', async () => {
    await write('dup.ts', 'same content');

    const result = await expandMentions('@dup.ts then @dup.ts', cwd);

    expect(result.match(/<file_content path="dup.ts">/g)).toHaveLength(1);
  });
});

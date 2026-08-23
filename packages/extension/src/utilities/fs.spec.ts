import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { isBinaryFile, searchWorkspaceFiles } from './fs';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'pi-search-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

async function write(rel: string, content = ''): Promise<void> {
  const abs = join(cwd, rel);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, content);
}

describe('searchWorkspaceFiles', () => {
  it('surfaces a deep folder once the query names its path', async () => {
    await write('packages/extension/src/shared/index.ts');
    await write('packages/extension/src/other.ts');

    // Previously a full-workspace walk could be crowded out by unrelated
    // matches before reaching this folder. Anchoring on the typed path must
    // surface it.
    const results = await searchWorkspaceFiles('packages/extension/src/shared', cwd);

    expect(results).toContain('packages/extension/src/shared');
  });

  it('returns nothing when the anchored directory does not exist', async () => {
    await write('packages/extension/src/index.ts');

    const results = await searchWorkspaceFiles('missing/ext', cwd);

    expect(results).toEqual([]);
  });

  it('lists the anchor directory contents for a trailing-slash query', async () => {
    await write('src/index.ts');
    await write('src/util.ts');

    const results = await searchWorkspaceFiles('src/', cwd);

    expect(results).toContain('src/index.ts');
    expect(results).toContain('src/util.ts');
  });

  it('ranks the shortest path match first, above a nested match', async () => {
    await write('context/something/patches');
    await write('patches');

    const results = await searchWorkspaceFiles('patches', cwd);

    expect(results[0]).toBe('patches');
    expect(results).toContain('context/something/patches');
  });

  it('ranks a basename-prefix match above a basename-infix match', async () => {
    await write('mypatches.ts');
    await write('patches.ts');

    const results = await searchWorkspaceFiles('patches', cwd);

    expect(results[0]).toBe('patches.ts');
  });

  it('lists bare @ candidates in environment discovery order', async () => {
    await write('file10.txt');
    await write('file2.txt');
    await write('notes.md');

    const results = await searchWorkspaceFiles('', cwd);

    // Numeric collation puts file2 ahead of file10, as the workspace listing shows.
    expect(results).toEqual(['file2.txt', 'file10.txt', 'notes.md']);
  });

  it('breaks ranking ties in discovery order, not locale order', async () => {
    await write('q10zz.txt');
    await write('q2aaa.txt');

    const results = await searchWorkspaceFiles('q', cwd);

    // Equal rank on every closeness field; the collator puts q2 first while
    // localeCompare would put q10 first.
    expect(results).toEqual(['q2aaa.txt', 'q10zz.txt']);
  });
});

describe('isBinaryFile', () => {
  let dir: string;
  let textFile: string;
  let binaryFile: string;
  let emptyFile: string;
  let lateNullFile: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pi-code-binary-'));

    textFile = join(dir, 'text.txt');
    await writeFile(textFile, 'hello\nworld\n');

    binaryFile = join(dir, 'binary.bin');
    await writeFile(binaryFile, Buffer.from([0x89, 0x50, 0x00, 0x4e]));

    emptyFile = join(dir, 'empty.txt');
    await writeFile(emptyFile, '');

    // NUL sits past the default sample window.
    lateNullFile = join(dir, 'late-null.bin');
    await writeFile(lateNullFile, Buffer.concat([Buffer.alloc(5000, 0x61), Buffer.from([0x00])]));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('detects a NUL byte inside the sample window', async () => {
    await expect(isBinaryFile(binaryFile)).resolves.toBe(true);
  });

  it('treats text and empty files as text', async () => {
    await expect(isBinaryFile(textFile)).resolves.toBe(false);
    await expect(isBinaryFile(emptyFile)).resolves.toBe(false);
  });

  it('only inspects the leading sample', async () => {
    await expect(isBinaryFile(lateNullFile)).resolves.toBe(false);
    await expect(isBinaryFile(lateNullFile, 8000)).resolves.toBe(true);
  });

  it('propagates errors for unreadable paths', async () => {
    await expect(isBinaryFile(join(dir, 'does-not-exist.txt'))).rejects.toThrow();
  });
});

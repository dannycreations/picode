import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { searchWorkspaceFiles } from './fs';

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
});

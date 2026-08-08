import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isBinaryFile, isBinaryFileSync } from '@pi-code/extension/utilities/binary';

let dir: string;
let textFile: string;
let binaryFile: string;
let emptyFile: string;
let lateNullFile: string;
let missingFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pi-code-binary-'));

  textFile = join(dir, 'text.txt');
  writeFileSync(textFile, 'hello\nworld\n');

  binaryFile = join(dir, 'binary.bin');
  writeFileSync(binaryFile, Buffer.from([0x89, 0x50, 0x00, 0x4e]));

  emptyFile = join(dir, 'empty.txt');
  writeFileSync(emptyFile, '');

  // NUL sits past the default sample window.
  lateNullFile = join(dir, 'late-null.bin');
  writeFileSync(lateNullFile, Buffer.concat([Buffer.alloc(5000, 0x61), Buffer.from([0x00])]));

  missingFile = join(dir, 'does-not-exist.txt');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isBinaryFile', () => {
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
    await expect(isBinaryFile(missingFile)).rejects.toThrow();
  });
});

describe('isBinaryFileSync', () => {
  it('agrees with the async variant on regular files', () => {
    expect(isBinaryFileSync(binaryFile)).toBe(true);
    expect(isBinaryFileSync(textFile)).toBe(false);
    expect(isBinaryFileSync(emptyFile)).toBe(false);
  });

  it('reports false instead of throwing for missing paths and directories', () => {
    expect(isBinaryFileSync(missingFile)).toBe(false);
    expect(isBinaryFileSync(dir)).toBe(false);
  });

  it('honours a custom sample size', () => {
    expect(isBinaryFileSync(lateNullFile)).toBe(false);
    expect(isBinaryFileSync(lateNullFile, 8000)).toBe(true);
  });
});

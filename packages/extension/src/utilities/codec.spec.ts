import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { extensionForMimeType, isBinaryFile, parseBase64DataUrl, toBase64DataUrl } from '@pi-code/extension/utilities/codec';

describe('parseBase64DataUrl', () => {
  it('splits a plain base64 data url', () => {
    expect(parseBase64DataUrl('data:image/png;base64,AAAA')).toEqual({ mimeType: 'image/png', data: 'AAAA' });
  });

  it('tolerates media-type parameters before the base64 marker', () => {
    expect(parseBase64DataUrl('data:image/svg+xml;charset=utf-8;base64,PHN2Zz48L3N2Zz4=')).toEqual({
      mimeType: 'image/svg+xml',
      data: 'PHN2Zz48L3N2Zz4=',
    });
  });

  it('keeps padding and slashes in the payload intact', () => {
    const data = 'iVBORw0KGgo/+A==';
    expect(parseBase64DataUrl(`data:image/png;base64,${data}`)?.data).toBe(data);
  });

  it('rejects non-base64 and malformed urls', () => {
    expect(parseBase64DataUrl('data:image/png,AAAA')).toBeNull();
    expect(parseBase64DataUrl('data:image/png;base64,')).toBeNull();
    expect(parseBase64DataUrl('https://example.com/a.png')).toBeNull();
    expect(parseBase64DataUrl('')).toBeNull();
  });
});

describe('toBase64DataUrl', () => {
  it('round-trips with the parser', () => {
    const url = toBase64DataUrl('AAAA', 'image/webp');
    expect(url).toBe('data:image/webp;base64,AAAA');
    expect(parseBase64DataUrl(url)).toEqual({ mimeType: 'image/webp', data: 'AAAA' });
  });

  it('falls back to png when the mime type is missing', () => {
    expect(toBase64DataUrl('AAAA')).toBe('data:image/png;base64,AAAA');
    expect(toBase64DataUrl('AAAA', '')).toBe('data:image/png;base64,AAAA');
  });
});

describe('extensionForMimeType', () => {
  it('uses the subtype when it is already a valid extension', () => {
    expect(extensionForMimeType('image/png')).toBe('png');
    expect(extensionForMimeType('image/webp')).toBe('webp');
  });

  it('maps subtypes that are not usable as extensions', () => {
    expect(extensionForMimeType('image/jpeg')).toBe('jpg');
    expect(extensionForMimeType('image/svg+xml')).toBe('svg');
    expect(extensionForMimeType('image/vnd.microsoft.icon')).toBe('ico');
  });

  it('normalises casing and whitespace', () => {
    expect(extensionForMimeType('  IMAGE/JPEG ')).toBe('jpg');
  });

  it('falls back to png for unusable input', () => {
    // Hyphenated subtypes are not safe bare extensions, so they fall back.
    expect(extensionForMimeType('application/octet-stream')).toBe('png');
    expect(extensionForMimeType('nonsense')).toBe('png');
    expect(extensionForMimeType('')).toBe('png');
  });
});

vi.mock('vscode', () => ({
  Uri: { file: (path: string) => ({ fsPath: path }) },
  workspace: { fs: { readFile: (uri: { fsPath: string }) => readFile(uri.fsPath) } },
}));

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

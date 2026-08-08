import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';

const BINARY_SAMPLE_BYTES = 4096;

function hasNullByte(buffer: Buffer, length: number): boolean {
  return buffer.subarray(0, length).includes(0);
}

export async function isBinaryFile(filePath: string, sampleBytes: number = BINARY_SAMPLE_BYTES): Promise<boolean> {
  let fileHandle;
  try {
    fileHandle = await open(filePath, 'r');
    const buffer = Buffer.alloc(sampleBytes);
    const { bytesRead } = await fileHandle.read(buffer, 0, sampleBytes, 0);
    return hasNullByte(buffer, bytesRead);
  } finally {
    await fileHandle?.close();
  }
}

export function isBinaryFileSync(filePath: string, sampleBytes: number = BINARY_SAMPLE_BYTES): boolean {
  try {
    if (!existsSync(filePath)) return false;
    if (statSync(filePath).isDirectory()) return false;

    const buffer = Buffer.alloc(sampleBytes);
    const fd = openSync(filePath, 'r');
    try {
      const bytesRead = readSync(fd, buffer, 0, sampleBytes, 0);
      return hasNullByte(buffer, bytesRead);
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

import { open } from 'node:fs/promises';

const BINARY_SAMPLE_BYTES = 4096;

export async function isBinaryFile(filePath: string, sampleBytes: number = BINARY_SAMPLE_BYTES): Promise<boolean> {
  let fileHandle;
  try {
    fileHandle = await open(filePath, 'r');
    const buffer = Buffer.alloc(sampleBytes);
    const { bytesRead } = await fileHandle.read(buffer, 0, sampleBytes, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await fileHandle?.close();
  }
}

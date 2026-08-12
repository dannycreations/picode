import { open } from 'node:fs/promises';

const BASE64_DATA_URL_PATTERN = /^data:([^;,]+)((?:;[^;,]+)*);base64,(.+)$/;

const DEFAULT_MIME_TYPE = 'image/png';
const DEFAULT_EXTENSION = 'png';

const MIME_EXTENSION_OVERRIDES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/vnd.microsoft.icon': 'ico',
  'image/x-icon': 'ico',
};

interface DataUrlParts {
  readonly mimeType: string;
  readonly data: string;
}

export function parseBase64DataUrl(value: string): DataUrlParts | null {
  const match = BASE64_DATA_URL_PATTERN.exec(value);
  if (!match) return null;

  return { mimeType: match[1], data: match[3] };
}

export function toBase64DataUrl(data: string, mimeType: string = DEFAULT_MIME_TYPE): string {
  return `data:${mimeType || DEFAULT_MIME_TYPE};base64,${data}`;
}

export function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  const override = MIME_EXTENSION_OVERRIDES[normalized];
  if (override) return override;

  const subtype = normalized.split('/')[1];
  if (!subtype) return DEFAULT_EXTENSION;

  // Strip structured-syntax suffixes (`+xml`) and vendor trees (`vnd.foo`).
  const cleaned = subtype.split('+')[0].split('.').pop() ?? '';
  return /^[a-z0-9]+$/.test(cleaned) ? cleaned : DEFAULT_EXTENSION;
}

export async function isBinaryFile(filePath: string, sampleBytes = 4096): Promise<boolean> {
  const buffer = Buffer.alloc(sampleBytes);
  const handle = await open(filePath, 'r');
  try {
    const { bytesRead } = await handle.read(buffer, 0, sampleBytes, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

import type { ImageContent } from '@earendil-works/pi-ai';
import type { Attachment, ImageAttachment } from '@pi-code/shared/core/types';

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

export function parseAttachments(attachments?: readonly Attachment[]): ImageContent[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;

  return attachments
    .filter((attachment): attachment is ImageAttachment => attachment.kind === 'image')
    .map((attachment) => {
      const parts = parseBase64DataUrl(attachment.dataUrl);
      return parts ? { type: 'image' as const, mimeType: parts.mimeType, data: parts.data } : null;
    })
    .filter((item): item is ImageContent => item !== null);
}

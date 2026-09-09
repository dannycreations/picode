const IMAGE_MAGIC_NUMBERS: readonly Uint8Array[] = [
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG
  Uint8Array.from([0xff, 0xd8, 0xff]), // JPEG
  Uint8Array.from([0x47, 0x49, 0x46, 0x38]), // GIF
  Uint8Array.from([0x52, 0x49, 0x46, 0x46]), // WEBP (RIFF container)
  Uint8Array.from([0x3c, 0x3f, 0x78, 0x6d, 0x6c]), // SVG (XML prolog)
  Uint8Array.from([0x3c, 0x73, 0x76, 0x67]), // SVG (bare <svg)
  Uint8Array.from([0x42, 0x4d]), // BMP
  Uint8Array.from([0x00, 0x00, 0x01, 0x00]), // ICO
  Uint8Array.from([0x49, 0x49, 0x2a, 0x00]), // TIFF (little-endian)
  Uint8Array.from([0x4d, 0x4d, 0x00, 0x2a]), // TIFF (big-endian)
];

async function readFilePrefix(file: File, maxBytes = 1024): Promise<Uint8Array> {
  const buffer = await file.slice(0, maxBytes).arrayBuffer();
  return new Uint8Array(buffer);
}

function isPrintableText(bytes: Uint8Array): boolean {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /^[\u0009\u000A\u000D\u0020-\u007E\u00A0-\u00FF]*$/.test(text);
  } catch {
    return false;
  }
}

function matchesAnyMagicNumber(bytes: Uint8Array, signatures: readonly Uint8Array[]): boolean {
  return signatures.some((signature) => signature.length <= bytes.length && signature.every((byte, i) => bytes[i] === byte));
}

export async function classifyFileByContent(file: File): Promise<'text' | 'image' | 'unknown'> {
  const prefix = await readFilePrefix(file);
  if (isPrintableText(prefix)) return 'text';
  if (matchesAnyMagicNumber(prefix, IMAGE_MAGIC_NUMBERS)) return 'image';
  return 'unknown';
}

export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) return '';
  return filename.slice(lastDot + 1).toLowerCase();
}

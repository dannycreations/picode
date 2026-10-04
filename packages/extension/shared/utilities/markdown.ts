// CommonMark fenced code blocks: up to three leading spaces, then three or more
// backticks or tildes. Backtick fences may not carry a backtick in the info string.
const OPENING_FENCE = /^ {0,3}(?:(`{3,})(?![^`]*`)|(~{3,}))[ \t]*(\S*)/;
const SURROUNDING_QUOTES = /^["']+|["']+$/g;

interface Fence {
  readonly char: string;
  readonly length: number;
  readonly language: string;
}

interface FencedBlock {
  readonly content: string;
  readonly language: string;
  readonly terminated: boolean;
}

function readOpeningFence(line: string): Fence | null {
  const match = OPENING_FENCE.exec(line);
  if (!match) return null;

  const marker = match[1] ?? match[2];
  return { char: marker[0], length: marker.length, language: match[3] };
}

export function findFencedBlock(raw: string, anchored: boolean): FencedBlock | null {
  const lines = raw.split('\n');

  let start: number;
  if (anchored) {
    start = lines.findIndex((line) => line.trim() !== '');
  } else {
    start = lines.findIndex((line) => readOpeningFence(line) !== null);
  }
  if (start === -1) return null;

  const fence = readOpeningFence(lines[start]);
  if (!fence) return null;

  // The closing pattern depends only on the opening fence, so compile it once
  // rather than recompiling it for every line scanned from the bottom.
  const closing = new RegExp(`^ {0,3}${fence.char}{${fence.length},}[ \\t\\r]*$`);

  // Scan from the bottom so nested fences inside a markdown block stay intact.
  for (let end = lines.length - 1; end > start; end--) {
    if (closing.test(lines[end])) {
      return { content: lines.slice(start + 1, end).join('\n'), language: fence.language, terminated: true };
    }
  }

  // Unterminated opener (streaming output): keep everything after it.
  return { content: lines.slice(start + 1).join('\n'), language: fence.language, terminated: false };
}

export function stripCodeBlock(raw: string): string {
  return findFencedBlock(raw, true)?.content ?? raw;
}

export function extractCodeBlock(raw: string): string {
  const body = findFencedBlock(raw, false)?.content ?? raw;
  const trimmed = body.trim();
  const withoutQuotes = trimmed.replace(SURROUNDING_QUOTES, '').trim();
  return trimmed.length > withoutQuotes.length ? withoutQuotes : trimmed;
}

export function wrapCodeBlock(content: string, language?: string): string {
  const fence = content.includes('```') ? '````' : '```';
  const info = language ? `${language}` : '';
  return [`${fence}${info}`, content.trim(), fence].join('\n');
}

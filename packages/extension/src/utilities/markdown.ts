// CommonMark fenced code blocks: up to three leading spaces, then three or more
// backticks or tildes. Backtick fences may not carry a backtick in the info string.
const OPENING_FENCE = /^ {0,3}(?:(`{3,})(?![^`]*`)|(~{3,}))/;
const SURROUNDING_QUOTES = /^["'`]+|["'`]+$/g;

interface Fence {
  readonly char: string;
  readonly length: number;
}

function readOpeningFence(line: string): Fence | null {
  const match = OPENING_FENCE.exec(line);
  if (!match) return null;

  const marker = match[1] ?? match[2];
  return { char: marker[0], length: marker.length };
}

function readFencedBody(raw: string, anchored: boolean): string | null {
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
      return lines.slice(start + 1, end).join('\n');
    }
  }

  // Unterminated opener (streaming output): keep everything after it.
  return lines.slice(start + 1).join('\n');
}

export function stripCodeFence(raw: string): string {
  return readFencedBody(raw, true) ?? raw;
}

export function extractCodeFenceMessage(raw: string): string {
  const body = readFencedBody(raw, false) ?? raw;
  return body.trim().replace(SURROUNDING_QUOTES, '').trim();
}

export function fencedMarkdown(content: string): string {
  const fence = content.includes('```') ? '````' : '```';
  return [`${fence}markdown`, content.trim(), fence].join('\n');
}

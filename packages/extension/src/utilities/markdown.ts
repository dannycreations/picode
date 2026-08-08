interface FenceInfo {
  readonly char: string;
  readonly length: number;
}

interface LineOffset {
  readonly start: number;
  readonly end: number;
}

function parseOpeningFence(str: string, start: number, end: number): FenceInfo | null {
  let i = start;

  // Allow up to 3 leading spaces (CommonMark spec)
  while (i < end && i - start < 3 && str.charCodeAt(i) === 32 /* ' ' */) {
    i++;
  }

  if (i >= end) return null;

  const charCode = str.charCodeAt(i);
  // 96 = '`', 126 = '~'
  if (charCode !== 96 && charCode !== 126) {
    return null;
  }

  const fenceStart = i;
  while (i < end && str.charCodeAt(i) === charCode) {
    i++;
  }

  const count = i - fenceStart;
  if (count < 3) {
    return null;
  }

  // Backtick fences cannot contain backticks in their info string
  if (charCode === 96) {
    for (let j = i; j < end; j++) {
      if (str.charCodeAt(j) === 96) return null;
    }
  }

  return {
    char: charCode === 96 ? '`' : '~',
    length: count,
  };
}

function isClosingFence(str: string, start: number, end: number, fenceChar: string, minLength: number): boolean {
  let i = start;

  // Allow up to 3 leading spaces
  while (i < end && i - start < 3 && str.charCodeAt(i) === 32 /* ' ' */) {
    i++;
  }

  if (i >= end) return false;

  const targetCode = fenceChar.charCodeAt(0);
  let count = 0;

  while (i < end && str.charCodeAt(i) === targetCode) {
    count++;
    i++;
  }

  if (count < minLength) {
    return false;
  }

  // Trailing characters must be spaces or line breaks
  while (i < end) {
    const code = str.charCodeAt(i);
    if (code !== 32 && code !== 9 && code !== 13) {
      // ' ', '\t', '\r'
      return false;
    }
    i++;
  }

  return true;
}

function getLineOffsets(str: string): LineOffset[] {
  const len = str.length;
  const lines: LineOffset[] = [];
  let lineStart = 0;

  while (lineStart <= len) {
    let lineEnd = str.indexOf('\n', lineStart);
    if (lineEnd === -1) {
      lineEnd = len;
    }

    const actualEnd = lineEnd > lineStart && str.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;

    lines.push({ start: lineStart, end: actualEnd });

    if (lineEnd === len) break;
    lineStart = lineEnd + 1;
  }

  return lines;
}

function findFencedBlockBounds(raw: string, requireStartAtBeginning: boolean): { bodyStart: number; bodyEnd: number } | null {
  const lines = getLineOffsets(raw);
  if (lines.length === 0) return null;

  let startIdx = 0;

  if (requireStartAtBeginning) {
    // Find first non-empty line
    while (startIdx < lines.length) {
      const { start, end } = lines[startIdx];
      if (start < end) {
        let isBlank = true;
        for (let i = start; i < end; i++) {
          const code = raw.charCodeAt(i);
          if (code !== 32 && code !== 9 && code !== 13) {
            isBlank = false;
            break;
          }
        }
        if (!isBlank) break;
      }
      startIdx++;
    }

    if (startIdx >= lines.length) return null;

    // For stripCodeFence, the first non-blank line MUST be the opener
    const { start, end } = lines[startIdx];
    const fence = parseOpeningFence(raw, start, end);
    if (!fence) return null;

    // Scan backwards from the bottom line so nested code fences remain intact
    for (let endIdx = lines.length - 1; endIdx > startIdx; endIdx--) {
      const closingLine = lines[endIdx];
      if (isClosingFence(raw, closingLine.start, closingLine.end, fence.char, fence.length)) {
        const bodyStart = lines[startIdx + 1] ? lines[startIdx + 1].start : closingLine.start;
        let bodyEnd = closingLine.start;
        if (bodyEnd > bodyStart && raw.charCodeAt(bodyEnd - 1) === 10 /* \n */) {
          bodyEnd--;
          if (bodyEnd > bodyStart && raw.charCodeAt(bodyEnd - 1) === 13 /* \r */) {
            bodyEnd--;
          }
        }
        return { bodyStart, bodyEnd };
      }
    }

    // Unterminated block (streaming output): keep everything after the opener line
    const bodyStart = lines[startIdx + 1] ? lines[startIdx + 1].start : raw.length;
    return { bodyStart, bodyEnd: raw.length };
  } else {
    // For extractCodeFenceMessage: search for the first fenced block anywhere in text
    for (let start = 0; start < lines.length; start++) {
      const line = lines[start];
      const fence = parseOpeningFence(raw, line.start, line.end);
      if (!fence) continue;

      for (let endIdx = lines.length - 1; endIdx > start; endIdx--) {
        const closingLine = lines[endIdx];
        if (isClosingFence(raw, closingLine.start, closingLine.end, fence.char, fence.length)) {
          const bodyStart = lines[start + 1] ? lines[start + 1].start : closingLine.start;
          let bodyEnd = closingLine.start;
          if (bodyEnd > bodyStart && raw.charCodeAt(bodyEnd - 1) === 10) {
            bodyEnd--;
            if (bodyEnd > bodyStart && raw.charCodeAt(bodyEnd - 1) === 13) {
              bodyEnd--;
            }
          }
          return { bodyStart, bodyEnd };
        }
      }

      const bodyStart = lines[start + 1] ? lines[start + 1].start : raw.length;
      return { bodyStart, bodyEnd: raw.length };
    }

    return null;
  }
}

export function stripCodeFence(raw: string): string {
  const bounds = findFencedBlockBounds(raw, true);
  if (!bounds) {
    return raw;
  }
  return raw.slice(bounds.bodyStart, bounds.bodyEnd);
}

function stripSurroundingQuotesAndWhitespace(str: string): string {
  let start = 0;
  let end = str.length;

  // Trim whitespace
  while (start < end) {
    const code = str.charCodeAt(start);
    if (code === 32 || code === 9 || code === 10 || code === 13) start++;
    else break;
  }
  while (end > start) {
    const code = str.charCodeAt(end - 1);
    if (code === 32 || code === 9 || code === 10 || code === 13) end--;
    else break;
  }

  // Trim surrounding quote characters
  while (start < end) {
    const code = str.charCodeAt(start);
    if (code === 34 || code === 39 || code === 96)
      start++; // ", ', `
    else break;
  }
  while (end > start) {
    const code = str.charCodeAt(end - 1);
    if (code === 34 || code === 39 || code === 96) end--;
    else break;
  }

  // Final whitespace trim
  while (start < end) {
    const code = str.charCodeAt(start);
    if (code === 32 || code === 9 || code === 10 || code === 13) start++;
    else break;
  }
  while (end > start) {
    const code = str.charCodeAt(end - 1);
    if (code === 32 || code === 9 || code === 10 || code === 13) end--;
    else break;
  }

  return str.slice(start, end);
}

export function extractCodeFenceMessage(raw: string): string {
  const bounds = findFencedBlockBounds(raw, false);
  const body = bounds ? raw.slice(bounds.bodyStart, bounds.bodyEnd) : raw;
  return stripSurroundingQuotesAndWhitespace(body);
}

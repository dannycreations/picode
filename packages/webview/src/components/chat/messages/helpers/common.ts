// First changed line in the new (post-edit) file, from a unified diff's first
// hunk header: `@@ -oldStart,oldCount +newStart,newCount @@`.
export function getFirstDiffLine(diff?: string): number | undefined {
  if (!diff) return undefined;
  const match = diff.match(/^@@ -\d+(?:,\d+)? \+(\d+)/m);
  if (!match) return undefined;
  const line = Number.parseInt(match[1], 10);
  return Number.isFinite(line) && line > 0 ? line : undefined;
}

interface DiffStat {
  readonly added: number;
  readonly removed: number;
}

export function getDiffStat(diff?: string): DiffStat | undefined {
  if (!diff) return undefined;
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (/^\+\+\+ /.test(line) || /^--- /.test(line)) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  if (added === 0 && removed === 0) return undefined;
  return { added, removed };
}

// A tool result is either `{ details: { result | response } }` or an
// Anthropic-style `{ content: [{ text }] }`. Return the first human text.
export function extractResultText(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return '';
  const result = parsed as { details?: { result?: unknown; response?: unknown }; content?: unknown };
  if (typeof result.details?.result === 'string') return result.details.result;
  if (typeof result.details?.response === 'string') return result.details.response;
  if (Array.isArray(result.content) && typeof result.content[0]?.text === 'string') return result.content[0].text;
  return '';
}

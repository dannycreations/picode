import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uuidv7 } from '@earendil-works/pi-ai';
import { formatSize, generateDiffString, truncateHead, truncateTail } from '@earendil-works/pi-coding-agent';

import { hasRanges, numberLines, readLines } from '@pi-code/extension/utilities/fs';
import { logger } from '@pi-code/shared/core/logger';
import { BYTES_PER_KILOBYTE } from '@pi-code/shared/utilities/common';

import type { TruncationResult } from '@earendil-works/pi-coding-agent';
import type { CustomToolResult } from '@pi-code/extension/types/extension';
import type { LineRange } from '@pi-code/shared/core/types';

export function tempLogPath(kind: string): string {
  return join(tmpdir(), `pi-code-${kind}-${uuidv7().slice(0, 8)}.log`);
}

// Output that outgrew the budget is spilled so the model can read the rest
// instead of re-running the tool. A failed write is not fatal: the caller
// falls back to hinting at a narrower re-run.
export async function spillToTempLog(kind: string, content: string): Promise<string | undefined> {
  const path = tempLogPath(kind);
  try {
    await writeFile(path, content, 'utf8');
    return path;
  } catch (err) {
    logger.warn(`Failed to write ${kind} output to temp file:`, err);
    return undefined;
  }
}

export interface OutputLimits {
  readonly maxLines: number;
  readonly maxBytes: number;
}

type TruncateKeep = 'head' | 'tail';

interface TruncateOutputOptions {
  readonly limits: OutputLimits;
  readonly keep?: TruncateKeep;
}

export function shareOutputLimits(limits: OutputLimits, count: number): OutputLimits {
  if (count <= 1) return limits;
  return {
    maxLines: Math.max(1, Math.floor(limits.maxLines / count)),
    maxBytes: Math.max(BYTES_PER_KILOBYTE, Math.floor(limits.maxBytes / count)),
  };
}

function formatTruncationNotice(truncation: TruncationResult, keep: TruncateKeep, hint?: string): string | undefined {
  if (!truncation.truncated) return undefined;

  const suffix = hint ? `\n${hint}` : '';

  if (truncation.firstLineExceedsLimit) {
    return `Truncated: the first line on its own exceeds the ${formatSize(truncation.maxBytes)} output limit, so no content could be shown.${suffix}`;
  }

  if (truncation.lastLinePartial) {
    const lastLineSize = formatSize(truncation.outputBytes);
    return `Truncated: showing the last ${lastLineSize} of line ${truncation.totalLines} (${formatSize(truncation.maxBytes)} output limit).${suffix}`;
  }

  const position = keep === 'tail' ? 'last' : 'first';
  const scope = `showing the ${position} ${truncation.outputLines} of ${truncation.totalLines} lines`;

  if (truncation.truncatedBy === 'lines') {
    return `Truncated: ${scope} (${truncation.maxLines} line output limit).${suffix}`;
  }

  const sizes = `${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}, ${formatSize(truncation.maxBytes)} output limit`;
  return `Truncated: ${scope} (${sizes}).${suffix}`;
}

export function renderTruncatedText(truncation: TruncationResult, keep: TruncateKeep, hint?: string): string {
  const notice = formatTruncationNotice(truncation, keep, hint);
  if (!notice) {
    return truncation.content;
  }
  return truncation.content ? `${truncation.content}\n\n${notice}` : notice;
}

export function truncateOutput(content: string, options: TruncateOutputOptions): TruncationResult {
  const keep = options.keep ?? 'head';
  return keep === 'tail' ? truncateTail(content, options.limits) : truncateHead(content, options.limits);
}

interface ReadNumberedTextOptions {
  readonly ranges?: ReadonlyArray<LineRange>;
  readonly hint?: (truncation: TruncationResult) => string | undefined;
}

export async function readNumberedText(filePath: string, limits: OutputLimits, options?: ReadNumberedTextOptions): Promise<string> {
  const ranges = options?.ranges;
  // The ranges come straight from the model and are unbounded, so they fold in
  // one at a time instead of spreading onto the argument stack.
  const maxLines = hasRanges(ranges) ? ranges.reduce((max, range) => Math.max(max, 1, range.end), 0) : limits.maxLines;

  const lines = await readLines(filePath, maxLines);
  const truncation = truncateHead(numberLines(lines, ranges), limits);
  return renderTruncatedText(truncation, 'head', options?.hint?.(truncation));
}

interface FileChangeResultOptions {
  readonly limits: OutputLimits;
  readonly oldContent: string;
  readonly newContent: string;
  readonly successMessage: string;
  readonly hint: string;
}

export function buildFileChangeResult(opts: FileChangeResultOptions): CustomToolResult<{ diff: string }> {
  const diffResult = generateDiffString(opts.oldContent, opts.newContent);
  const truncation = truncateOutput(diffResult.diff || opts.successMessage, { limits: opts.limits });

  return {
    content: [{ type: 'text' as const, text: renderTruncatedText(truncation, 'head', opts.hint) }],
    details: { diff: diffResult.diff },
  };
}

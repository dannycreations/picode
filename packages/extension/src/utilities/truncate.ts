import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, generateDiffString, truncateHead, truncateTail } from '@earendil-works/pi-coding-agent';

import { SettingsService } from '@pi-code/extension/core/settings';
import { logger } from '@pi-code/shared/logger';

import type { TruncationResult } from '@earendil-works/pi-coding-agent';
import type { AppSettings } from '@pi-code/shared/settings';

export const BYTES_PER_KILOBYTE = 1024;

export interface OutputLimits {
  readonly maxLines: number;
  readonly maxBytes: number;
}

export const DEFAULT_OUTPUT_LIMITS: OutputLimits = {
  maxLines: DEFAULT_MAX_LINES,
  maxBytes: DEFAULT_MAX_BYTES,
};

export type TruncateKeep = 'head' | 'tail';

export type TruncationHint = string | ((truncation: TruncationResult) => string | undefined);

export interface TruncateOutputOptions {
  readonly limits: OutputLimits;
  readonly keep?: TruncateKeep;
  readonly hint?: TruncationHint;
}

export interface TruncatedOutput {
  readonly text: string;
  readonly truncation: TruncationResult;
}

export function toOutputLimits(settings: AppSettings): OutputLimits {
  return {
    maxLines: settings.maxToolOutputLines,
    maxBytes: settings.maxToolOutputSizeKb * BYTES_PER_KILOBYTE,
  };
}

export async function resolveOutputLimits(cwd: string): Promise<OutputLimits> {
  try {
    return toOutputLimits(await SettingsService.getInstance(cwd).load());
  } catch (err) {
    logger.warn('Failed to load tool output limits, using defaults:', err);
    return DEFAULT_OUTPUT_LIMITS;
  }
}

export function shareOutputLimits(limits: OutputLimits, count: number): OutputLimits {
  if (count <= 1) return limits;
  return {
    maxLines: Math.max(1, Math.floor(limits.maxLines / count)),
    maxBytes: Math.max(BYTES_PER_KILOBYTE, Math.floor(limits.maxBytes / count)),
  };
}

export function formatTruncationNotice(truncation: TruncationResult, keep: TruncateKeep = 'head', hint?: string): string | undefined {
  if (!truncation.truncated) return undefined;

  const suffix = hint ? ` ${hint}` : '';

  if (truncation.firstLineExceedsLimit) {
    return `[Truncated: the first line on its own exceeds the ${formatSize(truncation.maxBytes)} output limit, so no content could be shown.${suffix}]`;
  }

  if (truncation.lastLinePartial) {
    const lastLineSize = formatSize(truncation.outputBytes);
    return `[Truncated: showing the last ${lastLineSize} of line ${truncation.totalLines} (${formatSize(truncation.maxBytes)} output limit).${suffix}]`;
  }

  const position = keep === 'tail' ? 'last' : 'first';
  const scope = `showing the ${position} ${truncation.outputLines} of ${truncation.totalLines} lines`;

  if (truncation.truncatedBy === 'lines') {
    return `[Truncated: ${scope} (${truncation.maxLines} line output limit).${suffix}]`;
  }

  const sizes = `${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}, ${formatSize(truncation.maxBytes)} output limit`;
  return `[Truncated: ${scope} (${sizes}).${suffix}]`;
}

export function truncateOutput(content: string, options: TruncateOutputOptions): TruncatedOutput {
  const keep = options.keep ?? 'head';
  const truncation = keep === 'tail' ? truncateTail(content, options.limits) : truncateHead(content, options.limits);

  const hint = typeof options.hint === 'function' ? options.hint(truncation) : options.hint;
  const notice = formatTruncationNotice(truncation, keep, hint);
  if (!notice) {
    return { text: truncation.content, truncation };
  }

  const text = truncation.content ? `${truncation.content}\n\n${notice}` : notice;
  return { text, truncation };
}

export interface FileChangeResultOptions {
  readonly cwd: string;
  readonly oldContent: string;
  readonly newContent: string;
  readonly successMessage: string;
  readonly hint: string;
  readonly extraDetails?: Record<string, unknown>;
}

export async function buildFileChangeResult(opts: FileChangeResultOptions) {
  const diffResult = generateDiffString(opts.oldContent, opts.newContent);
  const limits = await resolveOutputLimits(opts.cwd);
  const { text } = truncateOutput(diffResult.diff || opts.successMessage, {
    limits,
    keep: 'head',
    hint: opts.hint,
  });

  return {
    content: [{ type: 'text' as const, text }],
    details: { diff: diffResult.diff, ...(opts.extraDetails ?? {}) },
  };
}

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { formatThrownValue } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { toolError, toolResult } from '@pi-code/extension/structures/tool-call/helpers/result';
import { isBinaryFile } from '@pi-code/extension/utilities/codec';
import { shareOutputLimits, toOutputLimits, truncateOutput } from '@pi-code/extension/utilities/truncate';

import type { OutputLimits } from '@pi-code/extension/utilities/truncate';
import type { ToolName } from '@pi-code/shared/core/types';

const MEGABYTE = 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 10 * MEGABYTE;
const DEFAULT_MAX_CONCURRENT_READS = 5;

async function readLines(filePath: string, maxLines?: number): Promise<string[]> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const lines: string[] = [];
  try {
    for await (const line of rl) {
      lines.push(line);
      if (maxLines !== undefined && lines.length >= maxLines) {
        break;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return lines;
}

function nextLineAfter(text: string): number | undefined {
  const lastBreak = text.lastIndexOf('\n');
  const lastLine = lastBreak === -1 ? text : text.slice(lastBreak + 1);
  const match = /^(\d+)\|/.exec(lastLine);
  return match ? Number(match[1]) + 1 : undefined;
}

interface FileRequest {
  readonly path: string;
  readonly line_ranges?: readonly (readonly [number, number])[];
}

interface FileSection {
  readonly path: string;
  readonly header: string;
  readonly body: string;
  readonly hasError: boolean;
}

function numberLines(lines: readonly string[], ranges: FileRequest['line_ranges']): string {
  if (!ranges || ranges.length === 0) {
    return lines.map((line, index) => `${index + 1}|${line}`).join('\n');
  }

  const parts: string[] = [];
  for (const range of ranges) {
    const start = Math.max(1, range[0]);
    const end = Math.min(lines.length, range[1]);

    if (start > end) {
      parts.push(`Invalid range: ${start}-${end}`);
      continue;
    }

    for (let i = start; i <= end; i++) {
      parts.push(`${i}|${lines[i - 1]}`);
    }
  }
  return parts.join('\n');
}

async function readFileSection(cwd: string, file: FileRequest, limits: OutputLimits): Promise<FileSection> {
  try {
    const resolvedPath = resolve(cwd, file.path);

    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) {
      return { path: file.path, header: '', body: `Error: "path" is not a regular file: ${file.path}`, hasError: true };
    }
    if (fileStat.size > MAX_FILE_SIZE_BYTES) {
      return {
        path: file.path,
        header: '',
        body: `Error: ${file.path} exceeds the 10 MB size limit (${(fileStat.size / MEGABYTE).toFixed(2)} MB).`,
        hasError: true,
      };
    }
    if (await isBinaryFile(resolvedPath)) {
      return { path: file.path, header: '', body: `Error: ${file.path} is binary and cannot be read as text.`, hasError: true };
    }

    const ranges = file.line_ranges;
    const hasRanges = ranges !== undefined && ranges.length > 0;

    // With ranges, stop streaming at the highest requested line number.
    const maxLines = hasRanges ? Math.max(...ranges.map((range) => Math.max(1, range[1]))) : undefined;
    const lines = await readLines(resolvedPath, maxLines);

    const header = hasRanges ? `File: ${file.path} (Ranges: ${JSON.stringify(ranges)})` : `File: ${file.path}`;
    const { text } = truncateOutput(numberLines(lines, ranges), {
      limits,
      keep: 'head',
      hint: (truncation) => {
        const next = nextLineAfter(truncation.content);
        return next === undefined
          ? `Use "line_ranges" on "${file.path}" to read a narrower slice.`
          : `Use "line_ranges" starting at line ${next} on "${file.path}" to continue.`;
      },
    });
    return { path: file.path, header, body: text, hasError: false };
  } catch (err) {
    return { path: file.path, header: '', body: `Error reading file ${file.path}: ${formatThrownValue(err)}`, hasError: true };
  }
}

async function mapConcurrent<T, R>(items: readonly T[], limit: number, signal: AbortSignal | undefined, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length && !signal?.aborted) {
      const index = nextIndex++;
      results[index] = await run(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

export const readFileTool = defineTool({
  name: 'read_file' as ToolName,
  label: 'Read File',
  description:
    'Read files and return contents prefixed with line numbers (lineNumber|lineContent). Always list every file you need in one call rather than issuing separate calls one by one. Use "line_ranges" to read a narrower slice.',
  parameters: Type.Object({
    files: Type.Array(
      Type.Object({
        path: Type.String({ description: 'Workspace-relative path of the file to read.' }),
        line_ranges: Type.Optional(
          Type.Array(
            Type.Tuple([
              Type.Integer({ minimum: 1, description: '1-based start line.' }),
              Type.Integer({ minimum: 1, description: '1-based end line, inclusive.' }),
            ]),
            {
              description: 'Optional ranges to read as [start, end] 1-based inclusive line numbers.',
            },
          ),
        ),
      }),
      { description: 'Files to read, at least one.', minItems: 1 },
    ),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    try {
      const settings = readAppSettings();
      const maxConcurrent = settings.maxConcurrentFileReads > 0 ? settings.maxConcurrentFileReads : DEFAULT_MAX_CONCURRENT_READS;
      const limits = toOutputLimits(settings);

      // Split the budget so one large file cannot consume the whole batch.
      const perFileLimits = shareOutputLimits(limits, params.files.length);

      const sections = await mapConcurrent(params.files, maxConcurrent, signal, (file) => readFileSection(ctx.cwd, file, perFileLimits));

      if (signal?.aborted) {
        return toolError('Error: read operation was aborted.');
      }

      const safeSections = sections.filter((section): section is FileSection => section !== undefined);
      const results = safeSections.map((section) => (section.hasError ? section.body : `${section.header}\n${section.body}`));
      const { text } = truncateOutput(results.join('\n\n'), {
        limits,
        keep: 'head',
        hint: 'Read fewer files per call to see the rest.',
      });

      const files = safeSections.map((section) => ({ path: section.path, content: section.body }));
      const allFailed = safeSections.length > 0 && safeSections.every((section) => section.hasError);
      return allFailed ? toolError(text, { files }) : toolResult(text, { files });
    } catch (err) {
      return toolError(`Error: ${formatThrownValue(err)}`);
    }
  },
});

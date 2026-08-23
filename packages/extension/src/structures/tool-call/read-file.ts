import { formatThrownValue } from '@earendil-works/pi-ai';
import { defineTool, resolvePath } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { toolError, toolErrorFrom, toolResult } from '@pi-code/extension/structures/tool-call/helpers';
import { checkReadableFile } from '@pi-code/extension/utilities/fs';
import { readNumberedText, shareOutputLimits, toOutputLimits } from '@pi-code/extension/utilities/truncate';

import type { OutputLimits } from '@pi-code/extension/utilities/truncate';
import type { ToolName } from '@pi-code/shared/core/types';

const DEFAULT_MAX_CONCURRENT_READS = 5;

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

async function readFileSection(cwd: string, file: FileRequest, limits: OutputLimits): Promise<FileSection> {
  try {
    const resolvedPath = resolvePath(file.path, cwd);

    const check = await checkReadableFile(resolvedPath);
    if (!check.ok) {
      return { path: file.path, header: '', body: check.body, hasError: true };
    }

    const ranges = file.line_ranges;
    const header = ranges !== undefined && ranges.length > 0 ? `File: ${file.path} (Ranges: ${JSON.stringify(ranges)})` : `File: ${file.path}`;

    const numbered = await readNumberedText(resolvedPath, limits, {
      ranges,
      hint: (truncation) => {
        const next = nextLineAfter(truncation.content);
        return next === undefined
          ? `Use "line_ranges" on "${file.path}" to read a narrower slice.`
          : `Use "line_ranges" starting at line ${next} on "${file.path}" to continue.`;
      },
    });
    return { path: file.path, header, body: numbered, hasError: false };
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
  description: 'Read files and return their contents, prefixed with line numbers. Always prefer reading multiple files at once if possible.',
  parameters: Type.Object({
    files: Type.Array(
      Type.Object({
        path: Type.String({ description: 'Workspace-relative path of the file.' }),
        line_ranges: Type.Optional(
          Type.Array(
            Type.Tuple([
              Type.Integer({ minimum: 1, description: '1-based start line.' }),
              Type.Integer({ minimum: 1, description: '1-based end line, inclusive.' }),
            ]),
            { description: 'Optional [start, end] ranges of 1-based inclusive line numbers.' },
          ),
        ),
      }),
      { minItems: 1, description: 'One or more files to read.' },
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

      const text = sections.map((section) => (section.hasError ? section.body : `${section.header}\n${section.body}`)).join('\n\n');

      const files = sections.map((section) => ({ path: section.path, content: section.body }));
      const allFailed = sections.length > 0 && sections.every((section) => section.hasError);
      return allFailed ? toolError(text, { files }) : toolResult(text, { files });
    } catch (err) {
      return toolErrorFrom(err, 'reading file');
    }
  },
});

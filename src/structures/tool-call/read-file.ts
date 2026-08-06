import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { SettingsService } from '@extension/core/settings';
import { DEFAULT_OUTPUT_LIMITS, shareOutputLimits, toOutputLimits, truncateOutput } from '@extension/utilities/truncate';

import type { ToolName } from '@extension/types/webview';
import type { OutputLimits } from '@extension/utilities/truncate';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const BINARY_CHECK_BYTES = 4096;

async function isBinaryFile(filePath: string): Promise<boolean> {
  let fileHandle;
  try {
    fileHandle = await open(filePath, 'r');
    const buffer = Buffer.alloc(BINARY_CHECK_BYTES);
    const { bytesRead } = await fileHandle.read(buffer, 0, BINARY_CHECK_BYTES, 0);

    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }
    return false;
  } finally {
    await fileHandle?.close();
  }
}

async function readLinesUpTo(filePath: string, maxLines: number, signal?: AbortSignal): Promise<string[]> {
  const stream = createReadStream(filePath, { encoding: 'utf8', signal });
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const lines: string[] = [];
  try {
    for await (const line of rl) {
      if (signal?.aborted) break;
      lines.push(line);
      if (lines.length >= maxLines) {
        break;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return lines;
}

async function readAllFormattedLines(filePath: string, signal?: AbortSignal): Promise<string[]> {
  const stream = createReadStream(filePath, { encoding: 'utf8', signal });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  const lines: string[] = [];
  let lineNum = 0;
  try {
    for await (const line of rl) {
      if (signal?.aborted) break;
      lineNum++;
      lines.push(`${lineNum}|${line}`);
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

function truncateFileSection(header: string, body: string, path: string, limits: OutputLimits): string {
  const { text } = truncateOutput(body, {
    limits,
    keep: 'head',
    hint: (truncation) => {
      const next = nextLineAfter(truncation.content);
      return next === undefined
        ? `Use line_ranges on "${path}" to read a narrower slice.`
        : `Use line_ranges starting at line ${next} on "${path}" to continue.`;
    },
  });

  return `${header}\n${text}`;
}

export const readFileTool = defineTool({
  name: 'read_file' as ToolName,
  label: 'Read File',
  description: 'Read one or more files and return their contents with line numbers (format: lineNumber|lineContent) for diffing or discussion.',
  parameters: Type.Object({
    files: Type.Array(
      Type.Object({
        path: Type.String({ description: 'Path to the file to read, relative to the workspace' }),
        line_ranges: Type.Optional(
          Type.Array(
            Type.Tuple([
              Type.Integer({ minimum: 1, description: '1-based start line' }),
              Type.Integer({ minimum: 1, description: '1-based end line (inclusive)' }),
            ]),
            {
              description: 'Optional line ranges to read. Each range is a [start, end] tuple with 1-based inclusive line numbers.',
            },
          ),
        ),
      }),
      { description: 'List of files to read', minItems: 1 },
    ),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      let maxConcurrent = 5;
      let limits = DEFAULT_OUTPUT_LIMITS;
      try {
        const settingsService = SettingsService.getInstance(ctx.cwd);
        const settings = await settingsService.load();
        if (typeof settings?.maxConcurrentFileReads === 'number' && settings.maxConcurrentFileReads > 0) {
          maxConcurrent = settings.maxConcurrentFileReads;
        }
        limits = toOutputLimits(settings);
      } catch {}

      // Split the budget so one large file cannot consume the whole batch.
      const perFileLimits = shareOutputLimits(limits, params.files.length);

      const fileResults: { result: string; hasError: boolean }[] = Array(params.files.length);

      const processFile = async (index: number) => {
        if (_signal?.aborted) return;
        const fileObj = params.files[index];

        try {
          const resolvedPath = resolve(ctx.cwd, fileObj.path);

          const fileStat = await stat(resolvedPath);
          if (!fileStat.isFile()) {
            fileResults[index] = {
              result: `Error: Path is not a regular file: ${fileObj.path}`,
              hasError: true,
            };
            return;
          }

          if (fileStat.size > MAX_FILE_SIZE_BYTES) {
            fileResults[index] = {
              result: `Error: File ${fileObj.path} size (${(fileStat.size / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of 10 MB.`,
              hasError: true,
            };
            return;
          }

          if (await isBinaryFile(resolvedPath)) {
            fileResults[index] = {
              result: `Error: File is binary and cannot be read as text: ${fileObj.path}`,
              hasError: true,
            };
            return;
          }

          let header = '';
          let body = '';

          if (fileObj.line_ranges && fileObj.line_ranges.length > 0) {
            const maxRequestedLine = Math.max(...fileObj.line_ranges.map((range) => Math.max(1, range[1])));

            // Stream file up to the highest requested line number and stop early
            const lines = await readLinesUpTo(resolvedPath, maxRequestedLine, _signal);

            header = `File: ${fileObj.path} (Ranges: ${JSON.stringify(fileObj.line_ranges)})`;
            const parts: string[] = [];

            for (const range of fileObj.line_ranges) {
              const start = Math.max(1, range[0]);
              const end = Math.min(lines.length, range[1]);

              if (start > end) {
                parts.push(`[Invalid range ${start}-${end}]`);
                continue;
              }

              for (let i = start; i <= end; i++) {
                parts.push(`${i}|${lines[i - 1]}`);
              }
            }
            body = parts.join('\n');
          } else {
            const numberedLines = await readAllFormattedLines(resolvedPath, _signal);
            header = `File: ${fileObj.path}`;
            body = numberedLines.join('\n');
          }

          fileResults[index] = {
            result: truncateFileSection(header, body, fileObj.path, perFileLimits),
            hasError: false,
          };
        } catch (err) {
          fileResults[index] = {
            result: `Error reading file ${fileObj.path}: ${err instanceof Error ? err.message : String(err)}`,
            hasError: true,
          };
        }
      };

      // Run workers using a lock-free index counter and fixed concurrency worker pool
      let nextIndex = 0;
      const workerCount = Math.min(maxConcurrent, params.files.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < params.files.length) {
          if (_signal?.aborted) break;
          const index = nextIndex++;
          await processFile(index);
        }
      });

      await Promise.all(workers);

      if (_signal?.aborted) {
        return {
          content: [{ type: 'text', text: 'Error: Read operation was aborted.' }],
          details: {},
          isError: true,
        };
      }

      const results = fileResults.map((r) => r?.result ?? 'Error: File processing failed.');
      const allFailed = fileResults.length > 0 && fileResults.every((r) => r?.hasError);

      // Final cap: per-file headers and separators sit outside the shared budget.
      const { text } = truncateOutput(results.join('\n\n'), {
        limits,
        keep: 'head',
        hint: 'Request fewer files per call to see the rest.',
      });

      return {
        content: [{ type: 'text', text }],
        details: {},
        isError: allFailed,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});

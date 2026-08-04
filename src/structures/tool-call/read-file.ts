import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { SettingsService } from '@extension/core/settings';

import type { ToolName } from '@extension/types/webview';

export const readFileTool = defineTool({
  name: 'read_file' as ToolName,
  label: 'Read File',
  description: 'Read one or more files and return their contents with line numbers (format: lineNumber|lineContent) for diffing or discussion.',
  parameters: Type.Object({
    files: Type.Array(
      Type.Object({
        path: Type.String({ description: 'Path to the file to read, relative to the workspace' }),
        line_ranges: Type.Optional(
          Type.Array(Type.Array(Type.Integer(), { minItems: 2, maxItems: 2 }), {
            description: 'Optional line ranges to read. Each range is a [start, end] tuple with 1-based inclusive line numbers.',
          }),
        ),
      }),
      { description: 'List of files to read' },
    ),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const settingsService = SettingsService.getInstance(ctx.cwd);
      const settings = await settingsService.load();
      const maxConcurrent = settings.maxConcurrentFileReads;

      const fileResults: { result: string; hasError: boolean }[] = Array(params.files.length);

      const processFile = async (index: number) => {
        const fileObj = params.files[index];
        const resolvedPath = resolve(ctx.cwd, fileObj.path);

        try {
          const content = await readFile(resolvedPath, 'utf8');

          // Check if file is binary (rough check using null bytes)
          if (content.includes('\0')) {
            fileResults[index] = {
              result: `Error: File is binary and cannot be read as text: ${fileObj.path}`,
              hasError: true,
            };
            return;
          }

          const lines = content.split(/\r?\n/);
          let resultText = '';

          if (fileObj.line_ranges && fileObj.line_ranges.length > 0) {
            let fileRangeContent = `File: ${fileObj.path} (Ranges: ${JSON.stringify(fileObj.line_ranges)})\n`;
            for (const range of fileObj.line_ranges) {
              const start = Math.max(1, range[0]);
              const end = Math.min(lines.length, range[1]);

              if (start > end) {
                fileRangeContent += `[Invalid range ${start}-${end}]\n`;
                continue;
              }

              for (let i = start; i <= end; i++) {
                fileRangeContent += `${i}|${lines[i - 1]}\n`;
              }
            }
            resultText = fileRangeContent.trimEnd();
          } else {
            const numberedLines = lines.map((line, idx) => `${idx + 1}|${line}`).join('\n');
            resultText = `File: ${fileObj.path}\n${numberedLines}`;
          }

          fileResults[index] = { result: resultText, hasError: false };
        } catch (err) {
          fileResults[index] = {
            result: `Error reading file ${fileObj.path}: ${err instanceof Error ? err.message : String(err)}`,
            hasError: true,
          };
        }
      };

      // Run with concurrency limit
      const queue = Array.from({ length: params.files.length }, (_, i) => i);
      const promises = Array.from({ length: Math.min(maxConcurrent, queue.length) }, async () => {
        while (queue.length > 0) {
          const index = queue.shift();
          if (index !== undefined) {
            await processFile(index);
          }
        }
      });
      await Promise.all(promises);

      const results = fileResults.map((r) => r.result);
      const hasError = fileResults.some((r) => r.hasError);

      return {
        content: [{ type: 'text', text: results.join('\n\n') }],
        details: {},
        isError: hasError && results.length === 1, // Only mark error if the entire request failed
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

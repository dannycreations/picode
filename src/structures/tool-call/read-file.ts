import { readFile } from 'node:fs/promises';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { resolveWorkspacePath } from '@extension/utilities/path';

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
      const results: string[] = [];
      let hasError = false;

      for (const fileObj of params.files) {
        let resolvedPath: string;
        try {
          resolvedPath = resolveWorkspacePath(ctx.cwd, fileObj.path);
        } catch (err) {
          results.push(`Error: Cannot read file outside the workspace: ${fileObj.path}`);
          hasError = true;
          continue;
        }

        try {
          const content = await readFile(resolvedPath, 'utf8');

          // Check if file is binary (rough check using null bytes)
          if (content.includes('\0')) {
            results.push(`Error: File is binary and cannot be read as text: ${fileObj.path}`);
            hasError = true;
            continue;
          }

          const lines = content.split(/\r?\n/);

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
            results.push(fileRangeContent.trimEnd());
          } else {
            const numberedLines = lines.map((line, idx) => `${idx + 1}|${line}`).join('\n');
            results.push(`File: ${fileObj.path}\n${numberedLines}`);
          }
        } catch (err) {
          results.push(`Error reading file ${fileObj.path}: ${err instanceof Error ? err.message : String(err)}`);
          hasError = true;
        }
      }

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

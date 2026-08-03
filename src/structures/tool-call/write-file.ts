import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { defineTool, generateDiffString } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { resolveWorkspacePath } from '@extension/utilities/path';

import type { ToolName } from '@extension/types/webview';

export const writeFileTool = defineTool({
  name: 'write_file' as ToolName,
  label: 'Write File',
  description: 'Write complete content to a file. Overwrites the file if it exists, or creates it and any parent directories if it does not.',
  parameters: Type.Object({
    path: Type.String({ description: 'The path of the file to write to (relative to the current workspace directory)' }),
    content: Type.String({ description: 'The content to write to the file. ALWAYS provide the COMPLETE intended content, without truncation.' }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      let resolvedPath: string;
      try {
        resolvedPath = resolveWorkspacePath(ctx.cwd, params.path);
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
          details: {},
          isError: true,
        };
      }

      // Clean content from code block markers if present
      let finalContent = params.content;
      if (finalContent.startsWith('```')) {
        const lines = finalContent.split('\n');
        if (lines.length > 1) {
          finalContent = lines.slice(1).join('\n');
        }
      }
      if (finalContent.endsWith('```')) {
        const lines = finalContent.split('\n');
        if (lines.length > 1) {
          finalContent = lines.slice(0, -1).join('\n');
        }
      }

      // Check if file exists to read old content for generating a diff
      let oldContent = '';
      let fileExists = false;
      try {
        oldContent = await readFile(resolvedPath, 'utf8');
        fileExists = true;
      } catch {
        // File does not exist yet
      }

      // Create parent directories
      await mkdir(dirname(resolvedPath), { recursive: true });

      // Write content
      await writeFile(resolvedPath, finalContent, 'utf8');

      // Generate diff
      const diffResult = generateDiffString(oldContent, finalContent);

      return {
        content: [{ type: 'text', text: diffResult.diff || `Successfully wrote content to ${params.path}` }],
        details: {
          diff: diffResult.diff,
          fileExists,
        },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error writing to file: ${err instanceof Error ? err.message : String(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});

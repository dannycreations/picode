import { access, rm, stat, unlink } from 'node:fs/promises';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { resolveWorkspacePath } from '@extension/utilities/path';

import type { ToolName } from '@extension/types/webview';

export const deleteFileTool = defineTool({
  name: 'delete_file' as ToolName,
  label: 'Delete File',
  description: 'Delete a file or directory from the workspace. This action is irreversible.',
  parameters: Type.Object({
    path: Type.String({ description: 'Path to the file or directory to delete, relative to the workspace.' }),
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

      // Check if file exists
      try {
        await access(resolvedPath);
      } catch {
        return {
          content: [{ type: 'text', text: `Error: File or directory does not exist: ${params.path}` }],
          details: {},
          isError: true,
        };
      }

      const stats = await stat(resolvedPath);
      if (stats.isDirectory()) {
        await rm(resolvedPath, { recursive: true, force: true });
        return {
          content: [{ type: 'text', text: `Successfully deleted directory: ${params.path}` }],
          details: {},
        };
      } else {
        await unlink(resolvedPath);
        return {
          content: [{ type: 'text', text: `Successfully deleted file: ${params.path}` }],
          details: {},
        };
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error deleting file: ${err instanceof Error ? err.message : String(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});

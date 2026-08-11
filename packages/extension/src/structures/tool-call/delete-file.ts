import { access, rm, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { formatThrownValue } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import type { ToolName } from '@pi-code/shared/core/protocol';

export const deleteFileTool = defineTool({
  name: 'delete_file' as ToolName,
  label: 'Delete File',
  description: 'Delete a file or directory at "path" from the workspace. This action cannot be undone.',
  parameters: Type.Object({
    path: Type.String({ description: 'Workspace-relative path to the file or directory to delete.' }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const resolvedPath = resolve(ctx.cwd, params.path);

      try {
        await access(resolvedPath);
      } catch {
        return {
          content: [{ type: 'text', text: `Error: "path" does not exist: ${params.path}` }],
          details: {},
          isError: true,
        };
      }

      const stats = await stat(resolvedPath);
      if (stats.isDirectory()) {
        await rm(resolvedPath, { recursive: true, force: true });
        return {
          content: [{ type: 'text', text: `Deleted directory: ${params.path}` }],
          details: {},
        };
      } else {
        await unlink(resolvedPath);
        return {
          content: [{ type: 'text', text: `Deleted file: ${params.path}` }],
          details: {},
        };
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error deleting file: ${formatThrownValue(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});

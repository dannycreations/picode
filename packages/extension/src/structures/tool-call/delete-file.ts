import { access, rm, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { fileMutex } from '@pi-code/extension/structures/tool-call/helpers/mutex';
import { toolError, toolErrorFrom, toolResult } from '@pi-code/extension/structures/tool-call/helpers/result';

import type { ToolName } from '@pi-code/shared/core/types';

export const deleteFileTool = defineTool({
  name: 'delete_file' as ToolName,
  label: 'Delete File',
  description: 'Delete a file or directory at "path" from the workspace. This action cannot be undone.',
  parameters: Type.Object({
    path: Type.String({ description: 'Workspace-relative path to the file or directory to delete.' }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const resolvedPath = resolve(ctx.cwd, params.path);
    const release = await fileMutex.acquire(resolvedPath);
    try {
      try {
        await access(resolvedPath);
      } catch {
        return toolError(`Error: "path" does not exist: ${params.path}`);
      }

      const stats = await stat(resolvedPath);
      if (stats.isDirectory()) {
        await rm(resolvedPath, { recursive: true, force: true });
        return toolResult(`Deleted directory: ${params.path}`);
      }

      await unlink(resolvedPath);
      return toolResult(`Deleted file: ${params.path}`);
    } catch (err) {
      return toolErrorFrom(err, 'deleting file');
    } finally {
      release();
    }
  },
});

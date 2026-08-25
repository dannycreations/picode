import { rm, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineTool, getCwdRelativePath } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { runFileMutation, toolError, toolResult } from '@pi-code/extension/structures/tool-call/helpers';
import { isEnoent } from '@pi-code/extension/utilities/fs';

import type { Stats } from 'node:fs';
import type { ToolName } from '@pi-code/shared/core/types';

export const deleteFileTool = defineTool({
  name: 'delete_file' as ToolName,
  label: 'Delete File',
  description: 'Delete a file or directory permanently from the workspace. This action cannot be undone.',
  parameters: Type.Object({
    path: Type.String({ description: 'Workspace-relative path of the file or directory.' }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    return runFileMutation(ctx.cwd, params.path, 'deleting file', async (resolvedPath) => {
      // True when the workspace root sits at or under the target, so deleting
      // it would take the whole workspace with it.
      if (getCwdRelativePath(resolve(ctx.cwd), resolvedPath) !== undefined) {
        return toolError(`Error: refusing to delete "${params.path}" because it contains the workspace root.`);
      }

      let stats: Stats;
      try {
        stats = await stat(resolvedPath);
      } catch (err) {
        if (isEnoent(err)) {
          return toolError(`Error: \`path\` does not exist: ${params.path}`);
        }
        throw err;
      }

      if (stats.isDirectory()) {
        await rm(resolvedPath, { recursive: true, force: true });
        return toolResult(`Deleted directory: ${params.path}`);
      }

      await unlink(resolvedPath);
      return toolResult(`Deleted file: ${params.path}`);
    });
  },
});

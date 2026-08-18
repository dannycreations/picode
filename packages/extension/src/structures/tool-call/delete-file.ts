import { rm, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { withFileLock } from '@pi-code/extension/structures/tool-call/helpers/mutex';
import { toolError, toolErrorFrom, toolResult } from '@pi-code/extension/structures/tool-call/helpers/result';

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
    const resolvedPath = resolve(ctx.cwd, params.path);
    return withFileLock(resolvedPath, async () => {
      try {
        let stats: Stats;
        try {
          stats = await stat(resolvedPath);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return toolError(`Error: "path" does not exist: ${params.path}`);
          }
          throw err;
        }

        if (stats.isDirectory()) {
          await rm(resolvedPath, { recursive: true, force: true });
          return toolResult(`Deleted directory: ${params.path}`);
        }

        await unlink(resolvedPath);
        return toolResult(`Deleted file: ${params.path}`);
      } catch (err) {
        return toolErrorFrom(err, 'deleting file');
      }
    });
  },
});

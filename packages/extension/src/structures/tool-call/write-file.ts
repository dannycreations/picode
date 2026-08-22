import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { defineTool, resolvePath, withFileMutationQueue } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { readOutputLimits } from '@pi-code/extension/core/settings';
import { toolErrorFrom } from '@pi-code/extension/structures/tool-call/helpers';
import { checkReadableFile, writeFileAtomic } from '@pi-code/extension/utilities/fs';
import { stripCodeFence } from '@pi-code/extension/utilities/markdown';
import { buildFileChangeResult } from '@pi-code/extension/utilities/truncate';
import { logger } from '@pi-code/shared/core/logger';

import type { ToolName } from '@pi-code/shared/core/types';

export const writeFileTool = defineTool({
  name: 'write_file' as ToolName,
  label: 'Write File',
  description: 'Write complete content, overwriting it if it exists or creating it (and parent directories) otherwise.',
  parameters: Type.Object({
    path: Type.String({ description: 'Workspace-relative path of the file to write.' }),
    content: Type.String({ description: 'Complete file content; never truncate.' }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const resolvedPath = resolvePath(params.path, ctx.cwd);
    return withFileMutationQueue(resolvedPath, async () => {
      try {
        const finalContent = stripCodeFence(params.content);

        // Only build a diff from the prior content when the file is small enough
        // to load safely; large files are written without a diff.
        let oldContent = '';
        if ((await checkReadableFile(resolvedPath)).ok) {
          try {
            oldContent = await readFile(resolvedPath, 'utf8');
          } catch (err) {
            // A failed read is non-fatal: we still write the file, just without a diff.
            logger.warn(`Could not read prior content of ${resolvedPath}; writing without a diff.`, err);
          }
        }

        await mkdir(dirname(resolvedPath), { recursive: true });
        await writeFileAtomic(resolvedPath, finalContent);

        return buildFileChangeResult({
          limits: readOutputLimits(),
          oldContent,
          newContent: finalContent,
          successMessage: `Wrote ${params.path}`,
          hint: `Write applied; read "${params.path}" to verify the remaining changes.`,
        });
      } catch (err) {
        return toolErrorFrom(err, 'writing to file');
      }
    });
  },
});

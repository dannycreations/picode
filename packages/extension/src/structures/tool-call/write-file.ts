import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { fileMutex } from '@pi-code/extension/structures/tool-call/helpers/mutex';
import { toolErrorFrom } from '@pi-code/extension/structures/tool-call/helpers/result';
import { stripCodeFence } from '@pi-code/extension/utilities/markdown';
import { buildFileChangeResult } from '@pi-code/extension/utilities/truncate';

import type { ToolName } from '@pi-code/shared/core/types';

export const writeFileTool = defineTool({
  name: 'write_file' as ToolName,
  label: 'Write File',
  description:
    'Write complete content to "path", overwriting it if it exists or creating it (and parent directories) otherwise. Always pass the full content in "content".',
  parameters: Type.Object({
    path: Type.String({ description: 'Workspace-relative path of the file to write.' }),
    content: Type.String({ description: 'Complete file content; never truncate.' }),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const resolvedPath = resolve(ctx.cwd, params.path);
    const release = await fileMutex.acquire(resolvedPath);
    try {
      // Clean content from code block markers if present
      const finalContent = stripCodeFence(params.content);

      let oldContent = '';
      try {
        oldContent = await readFile(resolvedPath, 'utf8');
      } catch {}

      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, finalContent, 'utf8');

      return buildFileChangeResult({
        oldContent,
        newContent: finalContent,
        successMessage: `Wrote ${params.path}`,
        hint: `Write applied; read "${params.path}" to verify the remaining changes.`,
      });
    } catch (err) {
      return toolErrorFrom(err, 'writing to file');
    } finally {
      release();
    }
  },
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { formatThrownValue } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { stripCodeFence } from '@pi-code/extension/utilities/markdown';
import { buildFileChangeResult } from '@pi-code/extension/utilities/truncate';

import type { ToolName } from '@pi-code/shared/core/protocol';

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
    try {
      const resolvedPath = resolve(ctx.cwd, params.path);

      // Clean content from code block markers if present
      const finalContent = stripCodeFence(params.content);

      let oldContent = '';
      try {
        oldContent = await readFile(resolvedPath, 'utf8');
      } catch {}

      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, finalContent, 'utf8');

      return buildFileChangeResult({
        cwd: ctx.cwd,
        oldContent,
        newContent: finalContent,
        successMessage: `Wrote ${params.path}`,
        hint: `Write applied; read "${params.path}" to verify the remaining changes.`,
      });
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error writing to file: ${formatThrownValue(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});

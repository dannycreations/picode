import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { stripCodeFence } from '@pi-code/extension/utilities/markdown';
import { buildFileChangeResult } from '@pi-code/extension/utilities/truncate';
import { toErrorMessage } from '@pi-code/shared/utilities/common';

import type { ToolName } from '@pi-code/shared/core/protocol';

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
      const resolvedPath = resolve(ctx.cwd, params.path);

      // Clean content from code block markers if present
      const finalContent = stripCodeFence(params.content);

      let oldContent = '';
      let fileExists = false;
      try {
        oldContent = await readFile(resolvedPath, 'utf8');
        fileExists = true;
      } catch {}

      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, finalContent, 'utf8');

      return buildFileChangeResult({
        cwd: ctx.cwd,
        oldContent,
        newContent: finalContent,
        successMessage: `Successfully wrote content to ${params.path}`,
        hint: `The write succeeded; read "${params.path}" if you need to verify the remaining changes.`,
        extraDetails: { fileExists },
      });
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error writing to file: ${toErrorMessage(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});

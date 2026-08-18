import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { withFileLock } from '@pi-code/extension/structures/tool-call/helpers/mutex';
import { toolError, toolErrorFrom } from '@pi-code/extension/structures/tool-call/helpers/result';
import { checkReadableFile } from '@pi-code/extension/structures/tool-call/read-file';
import { buildFileChangeResult } from '@pi-code/extension/utilities/truncate';
import { findOccurrences } from '@pi-code/shared/utilities/common';

import type { ToolName } from '@pi-code/shared/core/types';

type LineEnding = '\r\n' | '\n';

function safeLiteralReplace(str: string, oldString: string, newString: string): string {
  if (oldString === '' || !str.includes(oldString)) {
    return str;
  }
  return str.replaceAll(oldString, () => newString);
}

function detectLineEnding(content: string): LineEnding {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function normalizeToLF(content: string): string {
  return content.replaceAll('\r\n', '\n');
}

function restoreLineEnding(contentLF: string, eol: LineEnding): string {
  if (eol === '\n') return contentLF;
  return contentLF.replaceAll('\n', '\r\n');
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildWhitespaceTolerantRegex(oldLF: string): RegExp {
  if (oldLF === '') {
    return /(?!)/g;
  }
  let pattern = '';
  let i = 0;
  const len = oldLF.length;

  while (i < len) {
    if (/\s/.test(oldLF[i])) {
      let hasNewline = false;
      while (i < len && /\s/.test(oldLF[i])) {
        hasNewline = hasNewline || oldLF[i] === '\n';
        i++;
      }
      pattern += hasNewline ? '\\s+' : '[\\t ]+';
    } else {
      const start = i;
      while (i < len && !/\s/.test(oldLF[i])) {
        i++;
      }
      pattern += escapeRegExp(oldLF.slice(start, i));
    }
  }
  return new RegExp(pattern, 'g');
}

function buildTokenRegex(oldLF: string): RegExp {
  let pattern = '';
  let i = 0;
  const len = oldLF.length;
  let hasToken = false;

  while (i < len) {
    while (i < len && /\s/.test(oldLF[i])) {
      i++;
    }
    if (i >= len) break;

    const start = i;
    while (i < len && !/\s/.test(oldLF[i])) {
      i++;
    }

    if (hasToken) {
      pattern += '\\s+';
    }
    pattern += escapeRegExp(oldLF.slice(start, i));
    hasToken = true;
  }

  if (!hasToken) {
    return /(?!)/g;
  }
  return new RegExp(pattern, 'g');
}

function countRegexMatches(content: string, regex: RegExp): number {
  regex.lastIndex = 0;
  let count = 0;
  while (true) {
    const match = regex.exec(content);
    if (!match) break;
    count++;
    if (regex.lastIndex === match.index) {
      // Prevent infinite loop on 0-width matches
      regex.lastIndex++;
    }
  }
  regex.lastIndex = 0;
  return count;
}

type ReplacementOutcome = { readonly content: string; readonly error?: undefined } | { readonly content?: undefined; readonly error: string };

function replaceExpected(originalLF: string, oldLF: string, newLF: string, expected: number, filePath: string): ReplacementOutcome {
  const exact = findOccurrences(originalLF, oldLF, true).length;
  if (exact === expected) {
    return { content: safeLiteralReplace(originalLF, oldLF, newLF) };
  }

  const wsRegex = buildWhitespaceTolerantRegex(oldLF);
  const whitespace = countRegexMatches(originalLF, wsRegex);
  if (whitespace === expected) {
    return { content: originalLF.replace(wsRegex, () => newLF) };
  }

  const tokenRegex = buildTokenRegex(oldLF);
  const token = countRegexMatches(originalLF, tokenRegex);
  if (token === expected) {
    return { content: originalLF.replace(tokenRegex, () => newLF) };
  }

  return {
    error:
      `Error: matched ${exact} occurrence(s) of "old_string" in ${filePath}, but "expected" is ${expected}.\n` +
      `Exact: ${exact}, whitespace-tolerant: ${whitespace}, token-based: ${token}.\n\n` +
      `Verify "old_string" matches the target exactly as-is, including whitespace and line endings.`,
  };
}

export const editFileTool = defineTool({
  name: 'edit_file' as ToolName,
  label: 'Edit File',
  description: 'Replace a specified string within an existing file, or create the file when no existing string is provided.',
  parameters: Type.Object({
    file_path: Type.String({ description: 'Workspace-relative path of the file.' }),
    old_string: Type.String({ description: 'Exact literal text to replace; empty creates the file.' }),
    new_string: Type.String({ description: 'Replacement text for "old_string".' }),
    expected: Type.Optional(Type.Integer({ minimum: 1, description: 'Optional expected number of replacements; defaults to 1.' })),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const { file_path, old_string, new_string } = params;
    const resolvedPath = resolve(ctx.cwd, file_path);
    return withFileLock(resolvedPath, async () => {
      try {
        let fileExists = false;
        let originalContent = '';
        try {
          const check = await checkReadableFile(resolvedPath);
          if (!check.ok) {
            return toolError(`${check.body} Use "write_file" to overwrite this file, or "read_file" with "line_ranges" to inspect a portion.`);
          }
          fileExists = true;
        } catch (err: unknown) {
          const isEnoent = err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ENOENT';
          if (!isEnoent) {
            return toolErrorFrom(err, `accessing file ${file_path}`);
          }
        }

        if (fileExists) {
          originalContent = await readFile(resolvedPath, 'utf8');
        }

        if (fileExists && old_string === '') {
          return toolError(`Error: "file_path" already exists: ${file_path}. Use a non-empty "old_string" to modify it.`);
        }
        if (!fileExists && old_string !== '') {
          return toolError(`Error: "file_path" does not exist: ${file_path}. Set "old_string" to empty string to create a new file.`);
        }

        let newContent: string;

        if (!fileExists) {
          newContent = new_string;
          await mkdir(dirname(resolvedPath), { recursive: true });
          await writeFile(resolvedPath, newContent, 'utf8');
        } else {
          const originalEol = detectLineEnding(originalContent);
          const originalLF = normalizeToLF(originalContent);
          const oldLF = normalizeToLF(old_string);
          const newLF = normalizeToLF(new_string);

          if (oldLF === newLF) {
            return toolError('Error: "old_string" and "new_string" are identical; nothing to change.');
          }

          const expected = params.expected ?? 1;
          const outcome = replaceExpected(originalLF, oldLF, newLF, expected, file_path);
          if (outcome.error !== undefined) {
            return toolError(outcome.error);
          }

          newContent = restoreLineEnding(outcome.content, originalEol);
          await writeFile(resolvedPath, newContent, 'utf8');
        }

        return buildFileChangeResult({
          oldContent: originalContent,
          newContent,
          successMessage: `Updated ${file_path}`,
          hint: `Edit applied; read "${file_path}" to verify the remaining changes.`,
        });
      } catch (err) {
        return toolErrorFrom(err, 'editing file');
      }
    });
  },
});

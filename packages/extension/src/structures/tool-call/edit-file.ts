import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { formatThrownValue } from '@earendil-works/pi-ai';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { buildFileChangeResult } from '@pi-code/extension/utilities/truncate';

import type { ToolName } from '@pi-code/shared/core/protocol';

type LineEnding = '\r\n' | '\n';

function countOccurrences(str: string, substr: string): number {
  if (substr === '') return 0;
  let count = 0;
  let pos = str.indexOf(substr);
  while (pos !== -1) {
    count++;
    pos = str.indexOf(substr, pos + substr.length);
  }
  return count;
}

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
        if (oldLF[i] === '\n') {
          hasNewline = true;
        }
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

export const editFileTool = defineTool({
  name: 'edit_file' as ToolName,
  label: 'Edit File',
  description:
    'Replace "old_string" with "new_string" in an existing file, or create a new file when "old_string" is empty. Set "expected_replacements" to confirm the match count.',
  parameters: Type.Object({
    file_path: Type.String({ description: 'Workspace-relative path of the file to modify or create.' }),
    old_string: Type.String({ description: 'Exact literal text to replace. Leave empty to create a new file.' }),
    new_string: Type.String({ description: 'Replacement text for "old_string".' }),
    expected_replacements: Type.Optional(Type.Integer({ description: 'Expected number of replacements. Defaults to 1.', minimum: 1 })),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const { file_path, old_string, new_string } = params;
      const expected_replacements = params.expected_replacements ?? 1;

      const resolvedPath = resolve(ctx.cwd, file_path);

      let fileExists = false;
      let originalContent = '';
      try {
        originalContent = await readFile(resolvedPath, 'utf8');
        fileExists = true;
      } catch (err: unknown) {
        const isEnoent = err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'ENOENT';
        if (isEnoent) {
          fileExists = false;
        } else {
          return {
            content: [{ type: 'text', text: `Error reading file ${file_path}: ${formatThrownValue(err)}` }],
            details: {},
            isError: true,
          };
        }
      }

      if (fileExists) {
        if (old_string === '') {
          return {
            content: [{ type: 'text', text: `Error: "file_path" already exists: ${file_path}. Use a non-empty "old_string" to modify it.` }],
            details: {},
            isError: true,
          };
        }
      } else {
        if (old_string !== '') {
          return {
            content: [
              { type: 'text', text: `Error: "file_path" does not exist: ${file_path}. Set "old_string" to empty string to create a new file.` },
            ],
            details: {},
            isError: true,
          };
        }
      }

      let newContent = '';

      if (!fileExists) {
        // Creating new file
        newContent = new_string;
        await mkdir(dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, newContent, 'utf8');
      } else {
        // Modifying existing file
        const originalEol = detectLineEnding(originalContent);
        const originalLF = normalizeToLF(originalContent);
        const oldLF = normalizeToLF(old_string);
        const newLF = normalizeToLF(new_string);

        if (oldLF === newLF) {
          return {
            content: [{ type: 'text', text: 'Error: "old_string" and "new_string" are identical; nothing to change.' }],
            details: {},
            isError: true,
          };
        }

        let updatedLF = originalLF;

        // Strategy 1: Exact literal match (fast path)
        const exactOccurrences = countOccurrences(originalLF, oldLF);
        if (exactOccurrences === expected_replacements) {
          updatedLF = safeLiteralReplace(originalLF, oldLF, newLF);
        } else {
          // Strategy 2: Whitespace-tolerant regex (fallback)
          const wsRegex = buildWhitespaceTolerantRegex(oldLF);
          const wsOccurrences = countRegexMatches(originalLF, wsRegex);
          if (wsOccurrences === expected_replacements) {
            updatedLF = originalLF.replace(wsRegex, () => newLF);
          } else {
            // Strategy 3: Token-based regex (fallback)
            const tokenRegex = buildTokenRegex(oldLF);
            const tokenOccurrences = countRegexMatches(originalLF, tokenRegex);
            if (tokenOccurrences === expected_replacements) {
              updatedLF = originalLF.replace(tokenRegex, () => newLF);
            } else {
              // Mismatch error details
              let errorMsg = `Error: matched ${exactOccurrences} occurrence(s) of "old_string" in ${file_path}, but "expected_replacements" is ${expected_replacements}.\n`;
              errorMsg += `Exact: ${exactOccurrences}, whitespace-tolerant: ${wsOccurrences}, token-based: ${tokenOccurrences}.\n\n`;
              errorMsg += `Verify "old_string" matches the target exactly, including whitespace and line endings.`;
              return {
                content: [{ type: 'text', text: errorMsg }],
                details: {},
                isError: true,
              };
            }
          }
        }

        newContent = restoreLineEnding(updatedLF, originalEol);
        await writeFile(resolvedPath, newContent, 'utf8');
      }

      return buildFileChangeResult({
        cwd: ctx.cwd,
        oldContent: originalContent,
        newContent,
        successMessage: `Updated ${file_path}`,
        hint: `Edit applied; read "${file_path}" to verify the remaining changes.`,
      });
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error editing file: ${formatThrownValue(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { defineTool, generateDiffString } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { resolveWorkspacePath } from '@extension/utilities/path';

import type { ToolName } from '@extension/types/webview';

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
  if (!newString.includes('$')) {
    return str.replaceAll(oldString, newString);
  }
  const escapedNewString = newString.replaceAll('$', '$$$$');
  return str.replaceAll(oldString, escapedNewString);
}

function detectLineEnding(content: string): LineEnding {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function normalizeToLF(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function restoreLineEnding(contentLF: string, eol: LineEnding): string {
  if (eol === '\n') return contentLF;
  return contentLF.replace(/\n/g, '\r\n');
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildWhitespaceTolerantRegex(oldLF: string): RegExp {
  if (oldLF === '') {
    return new RegExp('(?!)', 'g');
  }
  const parts = oldLF.match(/(\s+|\S+)/g) ?? [];
  const whitespacePatternForRun = (run: string): string => {
    if (run.includes('\n')) {
      return '\\s+';
    }
    return '[\\t ]+';
  };
  const pattern = parts
    .map((part) => {
      if (/^\s+$/.test(part)) {
        return whitespacePatternForRun(part);
      }
      return escapeRegExp(part);
    })
    .join('');
  return new RegExp(pattern, 'g');
}

function buildTokenRegex(oldLF: string): RegExp {
  const tokens = oldLF.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return new RegExp('(?!)', 'g');
  }
  const pattern = tokens.map(escapeRegExp).join('\\s+');
  return new RegExp(pattern, 'g');
}

function countRegexMatches(content: string, regex: RegExp): number {
  const stable = new RegExp(regex.source, regex.flags);
  return Array.from(content.matchAll(stable)).length;
}

export const editFileTool = defineTool({
  name: 'edit_file' as ToolName,
  label: 'Edit File',
  description: 'Replace text in an existing file using literal replacement strategies, or create a new file.',
  parameters: Type.Object({
    file_path: Type.String({ description: 'The path to the file to modify or create, relative to the workspace.' }),
    old_string: Type.String({ description: 'The exact literal text to replace. Use empty string to create a new file.' }),
    new_string: Type.String({ description: 'The exact literal text to replace old_string with.' }),
    expected_replacements: Type.Optional(Type.Integer({ description: 'Number of replacements expected. Defaults to 1.', minimum: 1 })),
  }),
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    try {
      const { file_path, old_string, new_string } = params;
      const expected_replacements = params.expected_replacements ?? 1;

      let resolvedPath: string;
      try {
        resolvedPath = resolveWorkspacePath(ctx.cwd, file_path);
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
          details: {},
          isError: true,
        };
      }

      // Check if file exists
      let fileExists = false;
      let originalContent = '';
      try {
        originalContent = await readFile(resolvedPath, 'utf8');
        fileExists = true;
      } catch {
        // File does not exist
      }

      if (fileExists) {
        if (old_string === '') {
          return {
            content: [{ type: 'text', text: `Error: File already exists: ${file_path}. Use a non-empty old_string to modify it.` }],
            details: {},
            isError: true,
          };
        }
      } else {
        if (old_string !== '') {
          return {
            content: [{ type: 'text', text: `Error: File does not exist: ${file_path}. Set old_string to empty string to create a new file.` }],
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
            content: [{ type: 'text', text: 'Error: old_string and new_string are identical. No changes to apply.' }],
            details: {},
            isError: true,
          };
        }

        let updatedLF = originalLF;
        const wsRegex = buildWhitespaceTolerantRegex(oldLF);
        const tokenRegex = buildTokenRegex(oldLF);

        // Strategy 1: exact literal match
        const exactOccurrences = countOccurrences(originalLF, oldLF);
        if (exactOccurrences === expected_replacements) {
          updatedLF = safeLiteralReplace(originalLF, oldLF, newLF);
        } else {
          // Strategy 2: whitespace-tolerant regex
          const wsOccurrences = countRegexMatches(originalLF, wsRegex);
          if (wsOccurrences === expected_replacements) {
            updatedLF = originalLF.replace(wsRegex, () => newLF);
          } else {
            // Strategy 3: token-based regex
            const tokenOccurrences = countRegexMatches(originalLF, tokenRegex);
            if (tokenOccurrences === expected_replacements) {
              updatedLF = originalLF.replace(tokenRegex, () => newLF);
            } else {
              // Mismatch error details
              let errorMsg = `Error: Occurrence count mismatch for old_string in ${file_path}.\n`;
              errorMsg += `Expected: ${expected_replacements} replacement(s)\n`;
              errorMsg += `Found: ${exactOccurrences} exact literal match(es), ${wsOccurrences} whitespace-tolerant match(es), ${tokenOccurrences} token-based match(es).\n\n`;
              errorMsg += `Please verify that old_string matches the target content exactly (including whitespace and line endings).`;
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

      // Generate diff
      const diffResult = generateDiffString(originalContent, newContent);

      return {
        content: [{ type: 'text', text: diffResult.diff || `Successfully updated ${file_path}` }],
        details: {
          diff: diffResult.diff,
        },
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error editing file: ${err instanceof Error ? err.message : String(err)}` }],
        details: {},
        isError: true,
      };
    }
  },
});

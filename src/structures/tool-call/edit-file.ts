import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { defineTool, generateDiffString } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { resolveOutputLimits, truncateOutput } from '@extension/utilities/truncate';

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
            content: [{ type: 'text', text: `Error reading file ${file_path}: ${err instanceof Error ? err.message : String(err)}` }],
            details: {},
            isError: true,
          };
        }
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

      const diffResult = generateDiffString(originalContent, newContent);

      // Keep the full diff for the UI, but cap what the model receives.
      const limits = await resolveOutputLimits(ctx.cwd);
      const { text } = truncateOutput(diffResult.diff || `Successfully updated ${file_path}`, {
        limits,
        keep: 'head',
        hint: `The edit succeeded; read "${file_path}" if you need to verify the remaining changes.`,
      });

      return {
        content: [{ type: 'text', text }],
        details: { diff: diffResult.diff },
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

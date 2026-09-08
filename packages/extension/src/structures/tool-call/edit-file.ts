import { readFile } from 'node:fs/promises';
import { defineTool, detectLineEnding, normalizeToLF, restoreLineEndings } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { readOutputLimits } from '@pi-code/extension/core/settings';
import { runFileMutation, toolError } from '@pi-code/extension/structures/tool-call/helpers';
import { checkReadableFile, pathExists, writeFileAtomic } from '@pi-code/extension/utilities/fs';
import { buildFileChangeResult } from '@pi-code/extension/utilities/truncate';
import { findOccurrences } from '@pi-code/shared/utilities/common';

import type { CustomToolResult } from '@pi-code/extension/types/extension';
import type { ToolName } from '@pi-code/shared/core/types';

function safeLiteralReplace(str: string, oldString: string, newString: string): string {
  if (oldString === '' || !str.includes(oldString)) {
    return str;
  }
  return str.replaceAll(oldString, () => newString);
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

type MatchStrategy = 'exact' | 'whitespace' | 'token';

type ReplacementOutcome =
  | { readonly content: string; readonly strategy: MatchStrategy; readonly matched: number; readonly error?: undefined }
  | { readonly content?: undefined; readonly strategy?: undefined; readonly matched?: undefined; readonly error: string };

function replaceExpected(originalLF: string, oldLF: string, newLF: string, expected: number, filePath: string): ReplacementOutcome {
  const exact = findOccurrences(originalLF, oldLF, true).length;
  if (exact === expected) {
    return { content: safeLiteralReplace(originalLF, oldLF, newLF), strategy: 'exact', matched: exact };
  }

  const wsRegex = buildWhitespaceTolerantRegex(oldLF);
  const whitespace = countRegexMatches(originalLF, wsRegex);
  if (whitespace === expected) {
    return { content: originalLF.replace(wsRegex, () => newLF), strategy: 'whitespace', matched: whitespace };
  }

  const tokenRegex = buildTokenRegex(oldLF);
  const token = countRegexMatches(originalLF, tokenRegex);
  if (token === expected) {
    return { content: originalLF.replace(tokenRegex, () => newLF), strategy: 'token', matched: token };
  }

  return {
    error:
      `Error: matched ${exact} occurrence(s) of \`search\` in ${filePath}, but \`expected\` is ${expected}.\n` +
      `Exact: ${exact}, whitespace-tolerant: ${whitespace}, token-based: ${token}.\n\n` +
      `Verify \`search\` matches the target exactly as-is, including whitespace and line endings.`,
  };
}

function withMatchNote(
  result: CustomToolResult<{ diff: string }>,
  strategy: Exclude<MatchStrategy, 'exact'>,
  matched: number,
): CustomToolResult<{ diff: string }> {
  const mode = strategy === 'whitespace' ? 'whitespace-tolerant matching' : 'token-based matching';
  const note = `Note: matched ${matched} occurrence(s) using ${mode}; the file text differed from \`search\` in whitespace.`;
  return {
    ...result,
    content: result.content.map((part) => (part.type === 'text' ? { ...part, text: `${part.text}\n\n${note}` } : part)),
  };
}

export const editFileTool = defineTool({
  name: 'edit_file' as ToolName,
  label: 'Edit File',
  description: 'Replace a specified string within an existing file, or create the file when no existing string is provided.',
  parameters: Type.Object({
    path: Type.String({ description: 'Workspace-relative path of the file.' }),
    search: Type.String({ description: 'Verbatim text to replace; empty creates the file.' }),
    replace: Type.String({ description: 'Different text for the replacement `search` text' }),
    expected: Type.Optional(Type.Integer({ minimum: 1, description: 'Optional expected number of replacements; defaults to 1.' })),
  }),
  async execute(_toolCallId, params, signal, onUpdate, ctx) {
    const { path, search, replace } = params;
    const result = await runFileMutation(ctx.cwd, path, 'editing file', signal, async (resolvedPath) => {
      let originalContent: string | null = null;
      const check = await checkReadableFile(resolvedPath);
      if (check.ok) {
        if (search === '') {
          return toolError(`Error: \`path\` already exists: ${path}. Use a non-empty \`search\` to modify it.`);
        }
        originalContent = await readFile(resolvedPath, 'utf8');
      } else if (search !== '' || (await pathExists(resolvedPath))) {
        // A present-but-unreadable file must never fall through to creation,
        // which would overwrite it with `replace`.
        return toolError(`${check.body} Use \`write_file\` to overwrite this file, or \`read_file\` with \`ranges\` to inspect a portion.`);
      }

      if (originalContent === null) {
        await writeFileAtomic(resolvedPath, replace);

        return buildFileChangeResult({
          limits: readOutputLimits(),
          oldContent: '',
          newContent: replace,
          successMessage: `Created ${path}`,
          hint: `File created; read "${path}" to verify the contents.`,
        });
      }

      const originalEol = detectLineEnding(originalContent);
      const originalLF = normalizeToLF(originalContent);
      const oldLF = normalizeToLF(search);
      const newLF = normalizeToLF(replace);

      if (oldLF === newLF) {
        return toolError('Error: `search` and `replace` are identical; nothing to change.');
      }

      const expected = params.expected ?? 1;
      const outcome = replaceExpected(originalLF, oldLF, newLF, expected, path);
      if (outcome.error !== undefined) {
        return toolError(outcome.error);
      }

      const newContent = restoreLineEndings(outcome.content, originalEol);
      await writeFileAtomic(resolvedPath, newContent);

      const result = buildFileChangeResult({
        limits: readOutputLimits(),
        oldContent: originalContent,
        newContent,
        successMessage: `Updated ${path}`,
        hint: `Edit applied; read "${path}" to verify the remaining changes.`,
      });

      return outcome.strategy === 'exact' ? result : withMatchNote(result, outcome.strategy, outcome.matched);
    });
    onUpdate?.(result);
    return result;
  },
});

import { readFile } from 'node:fs/promises';
import { defineTool, detectLineEnding, normalizeToLF, restoreLineEndings } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { readOutputLimits } from '@pi-code/extension/core/settings';
import { runFileMutation, toolError } from '@pi-code/extension/structures/tool-call/helpers';
import { checkReadableFile, writeFileAtomic } from '@pi-code/extension/utilities/fs';
import { buildFileChangeResult } from '@pi-code/extension/utilities/truncate';
import { countOccurrences, escapeRegExp, isWhitespaceCode } from '@pi-code/shared/utilities/common';

import type { CustomToolResult } from '@pi-code/extension/types/extension';
import type { ToolName } from '@pi-code/shared/core/types';

interface TextToken {
  readonly text: string;
  readonly isWhitespace: boolean;
}

function tokenizeText(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let index = 0;

  while (index < text.length) {
    const isWhitespace = isWhitespaceCode(text.charCodeAt(index));
    const start = index;
    while (index < text.length && isWhitespaceCode(text.charCodeAt(index)) === isWhitespace) {
      index++;
    }
    tokens.push({ text: text.slice(start, index), isWhitespace });
  }

  return tokens;
}

function buildWhitespaceTolerantRegex(oldText: string): RegExp {
  const tokens = tokenizeText(oldText);
  if (tokens.length === 0) {
    return /(?!)/g;
  }

  let pattern = '';
  for (const token of tokens) {
    if (!token.isWhitespace) {
      pattern += escapeRegExp(token.text);
      continue;
    }
    // A run that spans a line break may stand for any whitespace, one that
    // does not may only stand for spaces and tabs.
    pattern += token.text.includes('\n') ? '\\s+' : '[\\t ]+';
  }
  return new RegExp(pattern, 'g');
}

function buildTokenRegex(oldText: string): RegExp {
  const tokens = tokenizeText(oldText).filter((token) => !token.isWhitespace);
  if (tokens.length === 0) {
    return /(?!)/g;
  }

  return new RegExp(tokens.map((token) => escapeRegExp(token.text)).join('\\s+'), 'g');
}

type MatchStrategy = 'exact' | 'whitespace' | 'token';

type ReplacementOutcome =
  | { readonly content: string; readonly strategy: MatchStrategy; readonly matched: number; readonly error?: undefined }
  | { readonly content?: undefined; readonly strategy?: undefined; readonly matched?: undefined; readonly error: string };

function replaceExpected(original: string, oldText: string, newText: string, expected: number, filePath: string): ReplacementOutcome {
  const exact = countOccurrences(original, oldText, true);
  if (exact === expected) {
    // The function replacer keeps `$&` and friends in `newText` literal; a
    // string replacement would expand them. `expected` is at least 1 and
    // `search` is non-empty by this point, so the needle is present and usable.
    return { content: original.replaceAll(oldText, () => newText), strategy: 'exact', matched: exact };
  }

  const wsRegex = buildWhitespaceTolerantRegex(oldText);
  // Both fallback patterns are built from non-empty escaped tokens, so every
  // match spans at least one character and `match` counts them all.
  const whitespace = original.match(wsRegex)?.length ?? 0;
  if (whitespace === expected) {
    return { content: original.replace(wsRegex, () => newText), strategy: 'whitespace', matched: whitespace };
  }

  const tokenRegex = buildTokenRegex(oldText);
  const token = original.match(tokenRegex)?.length ?? 0;
  if (token === expected) {
    return { content: original.replace(tokenRegex, () => newText), strategy: 'token', matched: token };
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
      } else if (search !== '' || !check.missing) {
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
      const searchLF = normalizeToLF(search);

      if (searchLF === normalizeToLF(replace)) {
        return toolError('Error: `search` and `replace` are identical; nothing to change.');
      }

      const matchTarget = restoreLineEndings(normalizeToLF(originalContent), originalEol);
      const oldText = restoreLineEndings(searchLF, originalEol);

      const expected = params.expected ?? 1;
      const outcome = replaceExpected(matchTarget, oldText, replace, expected, path);
      if (outcome.error !== undefined) {
        return toolError(outcome.error);
      }

      await writeFileAtomic(resolvedPath, outcome.content);

      const result = buildFileChangeResult({
        limits: readOutputLimits(),
        oldContent: originalContent,
        newContent: outcome.content,
        successMessage: `Updated ${path}`,
        hint: `Edit applied; read "${path}" to verify the remaining changes.`,
      });

      return outcome.strategy === 'exact' ? result : withMatchNote(result, outcome.strategy, outcome.matched);
    });
    onUpdate?.(result);
    return result;
  },
});

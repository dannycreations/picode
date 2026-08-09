import type { CommandItem } from '@pi-code/shared/core/protocol';

const TOKEN_PATTERN = /^\/(\S*)/;
const WORD_BOUNDARY_PATTERN = /[:\-_./]/;

export const COMMAND_SOURCE_LABEL: Record<CommandItem['source'], string> = {
  skill: 'skill',
  builtin: 'builtin',
};

interface CommandToken {
  readonly name: string;
  readonly end: number;
}

interface CommandQuery {
  readonly token: CommandToken;
  readonly query: string;
}

export function readCommandToken(text: string): CommandToken | null {
  const match = TOKEN_PATTERN.exec(text);
  if (!match) return null;

  return { name: match[1], end: match[0].length };
}

export function readCommandQuery(text: string, caret: number): CommandQuery | null {
  const token = readCommandToken(text);
  if (!token) return null;

  // The caret sits before the slash, or past the token and into the arguments.
  if (caret < 1 || caret > token.end) return null;

  return { token, query: text.slice(1, caret) };
}

function findCommand(commands: readonly CommandItem[], name: string): CommandItem | undefined {
  return commands.find((command) => command.name === name);
}

function isSubsequence(haystack: string, needle: string): boolean {
  let cursor = 0;
  for (const char of haystack) {
    if (char === needle[cursor]) cursor++;
    if (cursor === needle.length) return true;
  }
  return false;
}

function scoreCommand(name: string, query: string): number | null {
  if (!query) return 0;

  const haystack = name.toLowerCase();
  const needle = query.toLowerCase();

  if (haystack.startsWith(needle)) return 0;

  for (let index = 1; index < haystack.length; index++) {
    if (WORD_BOUNDARY_PATTERN.test(haystack[index - 1]) && haystack.startsWith(needle, index)) {
      return 1;
    }
  }

  if (haystack.includes(needle)) return 2;

  return isSubsequence(haystack, needle) ? 3 : null;
}

export function matchCommands(commands: readonly CommandItem[], query: string): CommandItem[] {
  return commands
    .map((command) => ({ command, score: scoreCommand(command.name, query) }))
    .filter((entry): entry is { command: CommandItem; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.command.name.localeCompare(b.command.name))
    .map((entry) => entry.command);
}

interface CommandInsertion {
  readonly text: string;
  readonly caret: number;
}

export function applyCommand(text: string, name: string): CommandInsertion {
  const token = readCommandToken(text);
  const rest = token ? text.slice(token.end) : text;
  const command = `/${name}`;
  const body = /^\s/.test(rest) ? rest : ` ${rest}`;

  return { text: `${command}${body}`, caret: command.length + 1 };
}

interface CommandSegments {
  readonly command: string;
  readonly rest: string;
}

export function splitCommand(text: string, commands: readonly CommandItem[]): CommandSegments | null {
  const token = readCommandToken(text);
  if (!token || !findCommand(commands, token.name)) return null;

  return { command: text.slice(0, token.end), rest: text.slice(token.end) };
}

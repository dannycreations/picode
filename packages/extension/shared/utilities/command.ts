import { parse } from 'shell-quote';

import type { ParseEntry } from 'shell-quote';

const SEPARATOR_OPS = ['&&', '||', ';', '|', '&'];

function tokenize(command: string): ParseEntry[] {
  try {
    return parse(command);
  } catch {
    throw new Error('Command could not be parsed into tokens.');
  }
}

function parseCommandLine(command: string): string[] {
  if (!command.trim()) return [];

  const subCommands: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) {
      subCommands.push(current.join(' '));
      current = [];
    }
  };

  for (const token of tokenize(command)) {
    if (typeof token === 'string') {
      current.push(token);
      continue;
    }
    if ('comment' in token) continue;

    if (token.op === 'glob') {
      current.push(token.pattern);
    } else if (SEPARATOR_OPS.includes(token.op)) {
      flush();
    } else {
      current.push(token.op);
    }
  }
  flush();
  return subCommands;
}

export function parseCommand(command: string): string[] {
  return command.split(/\r?\n/).flatMap((line) => parseCommandLine(line));
}

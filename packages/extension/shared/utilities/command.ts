import { parse } from 'shell-quote';

import type { ParseEntry } from 'shell-quote';

const SEPARATOR_OPS = ['&&', '||', ';', '|', '&'];

export interface CommandSegment {
  readonly text: string;
  readonly tokens: readonly string[];
}

function tokenize(command: string): ParseEntry[] {
  try {
    return parse(command);
  } catch {
    throw new Error('Command could not be parsed into tokens.');
  }
}

function parseCommandLine(command: string): CommandSegment[] {
  if (!command.trim()) return [];

  const segments: CommandSegment[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) {
      segments.push({ text: current.join(' '), tokens: [...current] });
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
  return segments;
}

export function parseCommand(command: string): CommandSegment[] {
  return command.split(/\r?\n/).flatMap((line) => parseCommandLine(line));
}

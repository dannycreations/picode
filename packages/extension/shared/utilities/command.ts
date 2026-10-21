import { parse } from 'shell-quote';

const SEPARATOR_OPS = ['&&', '||', ';', '|', '&'];

function tokenize(command: string): unknown[] {
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
    if (typeof token !== 'object' || token === null) {
      continue;
    }

    const tok = token as { op?: string; pattern?: string; comment?: string };
    if ('comment' in tok) continue;

    const { op, pattern } = tok;
    if (typeof op !== 'string') {
      if (typeof pattern === 'string') current.push(pattern);
      continue;
    }
    if (op === 'glob' && typeof pattern === 'string') {
      current.push(pattern);
    } else if (SEPARATOR_OPS.includes(op)) {
      flush();
    } else {
      current.push(op);
    }
  }
  flush();
  return subCommands;
}

export function parseCommand(command: string): string[] {
  return command.split(/\r?\n/).flatMap((line) => parseCommandLine(line));
}

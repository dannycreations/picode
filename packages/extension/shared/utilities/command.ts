import { parse } from 'shell-quote';

export type CommandTokenizer = (command: string) => unknown[];

const SEPARATOR_OPS = ['&&', '||', ';', '|', '&'];

function tokenize(command: string, tokenizer: CommandTokenizer): unknown[] {
  try {
    return tokenizer(command);
  } catch {
    throw new Error('Command could not be parsed into tokens.');
  }
}

function parseCommandLine(command: string, tokenizer: CommandTokenizer): string[] {
  if (!command.trim()) return [];

  const subCommands: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) {
      subCommands.push(current.join(' '));
      current = [];
    }
  };

  for (const token of tokenize(command, tokenizer)) {
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

const PARSE_CACHE_LIMIT = 256;
const parsedCommands = new Map<string, string[]>();

function parseCommandUncached(command: string, tokenizer: CommandTokenizer): string[] {
  return command.split(/\r?\n/).flatMap((line) => parseCommandLine(line, tokenizer));
}

export function parseCommand(command: string, tokenizer: CommandTokenizer = parse): string[] {
  if (tokenizer !== parse) return parseCommandUncached(command, tokenizer);

  const cached = parsedCommands.get(command);
  if (cached) return cached.slice();

  const result = parseCommandUncached(command, tokenizer);
  if (parsedCommands.size >= PARSE_CACHE_LIMIT) {
    const oldest = parsedCommands.keys().next();
    if (!oldest.done) parsedCommands.delete(oldest.value);
  }
  parsedCommands.set(command, result);
  return result.slice();
}

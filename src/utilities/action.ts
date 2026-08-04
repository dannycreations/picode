import { isAbsolute, relative, resolve } from 'node:path';
import { parse } from 'shell-quote';

type DecisionAction = 'approve' | 'deny' | 'confirm';

const GLOB_CACHE_LIMIT = 500;
const globCache = new Map<string, RegExp>();

const DANGEROUS_PATTERNS: readonly RegExp[] = [
  /\$\{([^}]*@[PQEAak][^}]*)\}/, // Parameter expansion flags
  /\$\{([^}]*[=+\-?][^}]*\\(?:[0-7]{3}|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}))[^}]*\}/i, // Escapes in parameter defaults
  /\$\{![^}]+\}/, // Indirect parameter expansion
  /\$\(\(/, // Arithmetic expansions
  /<<<\s*(?:\$\(|`)/, // Here-string command substitutions
  /=\([^)]+\)/, // Zsh process substitution
  /[*?+@!]\(e:[^:]+:\)/, // Zsh glob evaluation
  /\0/, // Null bytes
];

function getGlobRegex(pattern: string): RegExp | null {
  let regex = globCache.get(pattern);
  if (regex) return regex;

  const p = pattern.replace(/\\/g, '/');
  let regStr = '';

  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        regStr += '.*';
        i++;
        if (p[i + 1] === '/') {
          i++;
        }
      } else {
        regStr += '[^/]*';
      }
    } else if (c === '?') {
      regStr += '[^/]';
    } else if (['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'].includes(c)) {
      regStr += '\\' + c;
    } else {
      regStr += c;
    }
  }

  try {
    regex = new RegExp(`^${regStr}$`, 'i');
    if (globCache.size >= GLOB_CACHE_LIMIT) {
      const firstKey = globCache.keys().next().value;
      if (firstKey !== undefined) {
        globCache.delete(firstKey);
      }
    }
    globCache.set(pattern, regex);
    return regex;
  } catch {
    return null;
  }
}

export function matchesGlob(pattern: string, filePath: string): boolean {
  if (!pattern || !filePath) return false;
  const normalizedFile = filePath.replace(/\\/g, '/');
  const regex = getGlobRegex(pattern);
  return regex ? regex.test(normalizedFile) : false;
}

export function resolvePathAction(
  cwd: string | undefined,
  filePath: string,
  approveEnabled: boolean,
  allowedPatterns: string[],
  deniedPatterns: string[],
): DecisionAction {
  if (!approveEnabled) {
    return 'confirm';
  }

  if (!filePath || filePath.includes('\0')) {
    return 'deny';
  }

  const normalizedPath = filePath.replace(/\\/g, '/');

  let maxAllowedLen = -1;
  let maxDeniedLen = -1;
  let hasAllowedMatch = false;
  let hasDeniedMatch = false;

  for (let i = 0; i < allowedPatterns.length; i++) {
    const pat = allowedPatterns[i];
    if (pat === '*' || matchesGlob(pat, normalizedPath)) {
      hasAllowedMatch = true;
      if (pat.length > maxAllowedLen) {
        maxAllowedLen = pat.length;
      }
    }
  }

  for (let i = 0; i < deniedPatterns.length; i++) {
    const pat = deniedPatterns[i];
    if (pat === '*' || matchesGlob(pat, normalizedPath)) {
      hasDeniedMatch = true;
      if (pat.length > maxDeniedLen) {
        maxDeniedLen = pat.length;
      }
    }
  }

  if (hasAllowedMatch && hasDeniedMatch) {
    return maxDeniedLen >= maxAllowedLen ? 'deny' : 'approve';
  }

  if (hasDeniedMatch) {
    return 'deny';
  }

  if (hasAllowedMatch) {
    return 'approve';
  }

  if (cwd) {
    try {
      const absoluteCwd = resolve(cwd);
      const absoluteFile = resolve(cwd, filePath);
      const relativePath = relative(absoluteCwd, absoluteFile);

      const isInside = !relativePath.startsWith('..') && !isAbsolute(relativePath);
      if (isInside) {
        return 'approve';
      }
    } catch {
      return 'confirm';
    }
  }

  return 'confirm';
}

export function resolveCommandAction(command: string, approveEnabled: boolean, allowedPatterns: string[], deniedPatterns: string[]): DecisionAction {
  if (!approveEnabled) {
    return 'confirm';
  }

  if (containsDangerousSubstitution(command)) {
    return 'confirm';
  }

  const subCommands = parseCommand(command);
  if (subCommands.length === 0) {
    return 'approve';
  }

  let hasConfirm = false;

  for (let i = 0; i < subCommands.length; i++) {
    const subCmd = subCommands[i];
    const cmdWithoutRedirection = subCmd.replace(/\d*>&\d*/g, '').trim();

    const decisionWithRedirection = getSingleCommandDecision(subCmd, approveEnabled, allowedPatterns, deniedPatterns);

    if (decisionWithRedirection === 'deny') {
      return 'deny';
    }

    const decisionWithoutRedirection =
      cmdWithoutRedirection === subCmd
        ? decisionWithRedirection
        : getSingleCommandDecision(cmdWithoutRedirection, approveEnabled, allowedPatterns, deniedPatterns);

    if (decisionWithoutRedirection === 'deny') {
      return 'deny';
    }

    if (decisionWithRedirection === 'confirm' || decisionWithoutRedirection === 'confirm') {
      hasConfirm = true;
    }
  }

  return hasConfirm ? 'confirm' : 'approve';
}

export function parseCommand(command: string): string[] {
  if (!command || !command.trim()) {
    return [];
  }

  let tokens: unknown[];
  try {
    tokens = parse(command);
  } catch {
    return fallbackSplitCommand(command);
  }

  if (!Array.isArray(tokens)) {
    return fallbackSplitCommand(command);
  }

  const subCommands: string[] = [];
  let currentCommand: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (typeof token === 'object' && token !== null) {
      const tok = token as Readonly<{
        op: string;
        pattern: string;
      }>;

      if ('comment' in tok) {
        continue;
      }

      if ('op' in tok && typeof tok.op === 'string') {
        if (tok.op === 'glob' && 'pattern' in tok && typeof tok.pattern === 'string') {
          currentCommand.push(tok.pattern);
        } else if (['&&', '||', ';', '|', '&', '\n'].includes(tok.op)) {
          if (currentCommand.length > 0) {
            subCommands.push(currentCommand.join(' '));
            currentCommand = [];
          }
        } else {
          currentCommand.push(tok.op);
        }
      } else if ('pattern' in tok && typeof tok.pattern === 'string') {
        currentCommand.push(tok.pattern);
      }
    } else if (typeof token === 'string') {
      currentCommand.push(token);
    }
  }

  if (currentCommand.length > 0) {
    subCommands.push(currentCommand.join(' '));
  }

  return subCommands;
}

function fallbackSplitCommand(command: string): string[] {
  return command
    .split(/(?:&&|\|\||;|\||&|\r?\n)/)
    .map((cmd) => cmd.trim())
    .filter((cmd) => cmd.length > 0);
}

export function containsDangerousSubstitution(source: string): boolean {
  if (!source) return false;

  for (let i = 0; i < DANGEROUS_PATTERNS.length; i++) {
    if (DANGEROUS_PATTERNS[i].test(source)) {
      return true;
    }
  }

  if (process.platform === 'win32') {
    let inDoubleQuote = false;
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (char === '"') {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === '^' && !inDoubleQuote && i + 1 < source.length && source[i + 1] === '"') {
        return true;
      }
    }
  }

  return false;
}

function matchesCommandPattern(pattern: string, command: string): boolean {
  if (pattern === '*') return true;

  const pLower = pattern.toLowerCase();
  const cLower = command.toLowerCase();

  if (pLower === cLower) return true;

  if (pLower.includes('*') || pLower.includes('?')) {
    return matchesGlob(pLower, cLower);
  }

  if (cLower.startsWith(pLower)) {
    const nextChar = cLower.charAt(pLower.length);
    return nextChar === '' || nextChar === ' ' || nextChar === '\t';
  }

  return false;
}

export function getSingleCommandDecision(
  command: string,
  approveEnabled: boolean,
  allowedPatterns: string[],
  deniedPatterns: string[],
): DecisionAction {
  if (!approveEnabled) {
    return 'confirm';
  }

  const trimmedCmd = command.trim();
  if (!trimmedCmd) {
    return 'approve';
  }

  let maxAllowedLen = -1;
  let maxDeniedLen = -1;
  let hasAllowedMatch = false;
  let hasDeniedMatch = false;

  for (let i = 0; i < allowedPatterns.length; i++) {
    const pat = allowedPatterns[i];
    if (matchesCommandPattern(pat, trimmedCmd)) {
      hasAllowedMatch = true;
      if (pat.length > maxAllowedLen) {
        maxAllowedLen = pat.length;
      }
    }
  }

  for (let i = 0; i < deniedPatterns.length; i++) {
    const pat = deniedPatterns[i];
    if (matchesCommandPattern(pat, trimmedCmd)) {
      hasDeniedMatch = true;
      if (pat.length > maxDeniedLen) {
        maxDeniedLen = pat.length;
      }
    }
  }

  if (hasAllowedMatch && hasDeniedMatch) {
    return maxDeniedLen >= maxAllowedLen ? 'deny' : 'approve';
  }

  if (hasDeniedMatch) {
    return 'deny';
  }

  if (hasAllowedMatch) {
    return 'approve';
  }

  if (allowedPatterns.length === 0) {
    return 'approve';
  }

  return 'confirm';
}

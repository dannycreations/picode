import { isAbsolute, relative, resolve } from 'node:path';
import { parse } from 'shell-quote';

export function resolvePathAction(
  cwd: string | undefined,
  filePath: string,
  autoApproveEnabled: boolean,
  allowedPatterns: string[],
  deniedPatterns: string[],
): 'approve' | 'confirm' | 'deny' {
  if (!autoApproveEnabled) {
    return 'confirm';
  }

  const hasWildcard = allowedPatterns.some((pat) => pat === '*');

  const matchingAllowed = allowedPatterns.filter((pat) => matchesGlob(pat, filePath) || pat === '*');
  const matchingDenied = deniedPatterns.filter((pat) => matchesGlob(pat, filePath) || pat === '*');

  if (hasWildcard && matchingDenied.length === 0) {
    return 'approve';
  }

  if (matchingAllowed.length > 0 && matchingDenied.length > 0) {
    const longestAllowed = matchingAllowed.reduce((a, b) => (a.length >= b.length ? a : b), '');
    const longestDenied = matchingDenied.reduce((a, b) => (a.length >= b.length ? a : b), '');

    if (longestDenied.length >= longestAllowed.length) {
      return 'deny';
    } else {
      return 'approve';
    }
  }

  if (matchingDenied.length > 0) {
    return 'deny';
  }

  if (matchingAllowed.length > 0) {
    return 'approve';
  }

  if (cwd) {
    const absoluteCwd = resolve(cwd);
    const absoluteFile = resolve(cwd, filePath);
    const relativePath = relative(absoluteCwd, absoluteFile);

    const isInside = !relativePath.startsWith('..') && !isAbsolute(relativePath);
    if (isInside) {
      return 'approve';
    }
  }

  return 'confirm';
}

export function resolveCommandAction(
  command: string,
  autoApproveEnabled: boolean,
  allowedPatterns: string[],
  deniedPatterns: string[],
): 'approve' | 'confirm' | 'deny' {
  if (!autoApproveEnabled) {
    return 'confirm';
  }

  if (containsDangerousSubstitution(command)) {
    return 'confirm';
  }

  const subCommands = parseCommand(command);
  if (subCommands.length === 0) {
    return 'approve';
  }

  const decisions = subCommands.map((subCmd) => {
    const cmdWithoutRedirection = subCmd.replace(/\d*>&\d*/, '').trim();

    const decisionWithoutRedirection = getSingleCommandDecision(cmdWithoutRedirection, autoApproveEnabled, allowedPatterns, deniedPatterns);
    const decisionWithRedirection = getSingleCommandDecision(subCmd, autoApproveEnabled, allowedPatterns, deniedPatterns);

    if (decisionWithoutRedirection === 'deny' || decisionWithRedirection === 'deny') {
      return 'deny';
    }
    if (decisionWithoutRedirection === 'approve' || decisionWithRedirection === 'approve') {
      return 'approve';
    }
    return 'confirm';
  });

  if (decisions.includes('deny')) {
    return 'deny';
  }
  if (decisions.includes('confirm')) {
    return 'confirm';
  }
  return 'approve';
}

export function parseCommand(command: string): string[] {
  if (!command || !command.trim()) {
    return [];
  }

  let tokens: any[];
  try {
    tokens = parse(command);
  } catch (err) {
    return command
      .split(/(?:&&|\|\||;|\||&|\n)/)
      .map((cmd) => cmd.trim())
      .filter((cmd) => cmd.length > 0);
  }

  const subCommands: string[] = [];
  let currentCommand: string[] = [];

  for (const token of tokens) {
    if (typeof token === 'object' && token !== null) {
      if ('op' in token && ['&&', '||', ';', '|', '&'].includes(token.op)) {
        if (currentCommand.length > 0) {
          subCommands.push(currentCommand.join(' '));
          currentCommand = [];
        }
      } else if ('op' in token) {
        currentCommand.push(token.op);
      } else if ('pattern' in token) {
        currentCommand.push(token.pattern);
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

export function containsDangerousSubstitution(source: string): boolean {
  const dangerousParameterExpansion = /\$\{[^}]*@[PQEAa][^}]*\}/.test(source);

  const parameterAssignmentWithEscapes =
    /\$\{[^}]*[=+\-?][^}]*\\[0-7]{3}[^}]*\}/.test(source) ||
    /\$\{[^}]*[=+\-?][^}]*\\x[0-9a-fA-F]{2}[^}]*\}/.test(source) ||
    /\$\{[^}]*[=+\-?][^}]*\\u[0-9a-fA-F]{4}[^}]*\}/.test(source);

  const indirectExpansion = /\$\{![^}]+\}/.test(source);

  const hereStringWithSubstitution = /<<<\s*(\$\(|`)/.test(source);

  const zshProcessSubstitution = /=\([^)]+\)/.test(source);

  const zshGlobQualifier = /[*?+@!]\(e:[^:]+:\)/.test(source);

  let win32CaretQuoteBypass = false;
  if (process.platform === 'win32') {
    let inDoubleQuote = false;
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (char === '"') {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === '^' && !inDoubleQuote && source[i + 1] === '"') {
        win32CaretQuoteBypass = true;
        break;
      }
    }
  }

  return (
    dangerousParameterExpansion ||
    parameterAssignmentWithEscapes ||
    indirectExpansion ||
    hereStringWithSubstitution ||
    zshProcessSubstitution ||
    zshGlobQualifier ||
    win32CaretQuoteBypass
  );
}

export function getSingleCommandDecision(
  command: string,
  autoApproveEnabled: boolean,
  allowedPatterns: string[],
  deniedPatterns: string[],
): 'approve' | 'confirm' | 'deny' {
  if (!autoApproveEnabled) {
    return 'confirm';
  }

  const hasWildcard = allowedPatterns.some((pat) => pat === '*');

  const matchingAllowed = allowedPatterns.filter((pat) => command.toLowerCase().startsWith(pat.toLowerCase()) || pat === '*');
  const matchingDenied = deniedPatterns.filter((pat) => command.toLowerCase().startsWith(pat.toLowerCase()) || pat === '*');

  if (hasWildcard && matchingDenied.length === 0) {
    return 'approve';
  }

  if (matchingAllowed.length > 0 && matchingDenied.length > 0) {
    const longestAllowed = matchingAllowed.reduce((a, b) => (a.length >= b.length ? a : b), '');
    const longestDenied = matchingDenied.reduce((a, b) => (a.length >= b.length ? a : b), '');

    if (longestDenied.length >= longestAllowed.length) {
      return 'deny';
    } else {
      return 'approve';
    }
  }

  if (matchingDenied.length > 0) {
    return 'deny';
  }

  if (matchingAllowed.length > 0) {
    return 'approve';
  }

  if (allowedPatterns.length === 0) {
    return 'approve';
  }

  return 'confirm';
}

export function matchesGlob(pattern: string, filePath: string): boolean {
  const p = pattern.replace(/\\/g, '/');
  const f = filePath.replace(/\\/g, '/');

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

  const regex = new RegExp(`^${regStr}$`, 'i');
  return regex.test(f);
}

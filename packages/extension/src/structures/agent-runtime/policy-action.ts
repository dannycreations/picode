import { isAbsolute, join, relative, resolve } from 'node:path';
import { CONFIG_DIR_NAME, getAgentDir } from '@earendil-works/pi-coding-agent';
import { minimatch } from 'minimatch';
import { parse } from 'shell-quote';

import { normalizeSeparators } from '@pi-code/extension/utilities/fs';

import type { AppSettings } from '@pi-code/shared/core/settings';

export type ApprovalDecision = { action: 'approve' } | { action: 'deny'; reason: string } | { action: 'confirm' };

export function applyYoloDecision(settings: AppSettings, decision: ApprovalDecision): ApprovalDecision {
  if (!settings.yolo) return decision;
  if (settings.yoloRespectDenied && decision.action === 'deny') return decision;
  return { action: 'approve' };
}

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

export function matchesGlob(pattern: string, filePath: string): boolean {
  if (!pattern || !filePath) return false;
  const normalizedFile = normalizeSeparators(filePath);
  return minimatch(normalizedFile, pattern, { nocase: true, dot: true });
}

function resolveAllowDeny(
  allowedPatterns: readonly string[],
  deniedPatterns: readonly string[],
  isMatch: (pattern: string) => boolean,
): ApprovalDecision['action'] {
  let maxAllowedLen = -1;
  let maxDeniedLen = -1;
  let hasAllowedMatch = false;
  let hasDeniedMatch = false;

  for (const pat of allowedPatterns) {
    if (isMatch(pat)) {
      hasAllowedMatch = true;
      if (pat.length > maxAllowedLen) maxAllowedLen = pat.length;
    }
  }

  for (const pat of deniedPatterns) {
    if (isMatch(pat)) {
      hasDeniedMatch = true;
      if (pat.length > maxDeniedLen) maxDeniedLen = pat.length;
    }
  }

  if (hasAllowedMatch && hasDeniedMatch) {
    return maxDeniedLen >= maxAllowedLen ? 'deny' : 'approve';
  }
  if (hasDeniedMatch) return 'deny';
  if (hasAllowedMatch) return 'approve';
  return 'confirm';
}

export function resolvePathAction(
  cwd: string | undefined,
  filePath: string,
  approveEnabled: boolean,
  allowedPatterns: readonly string[],
  deniedPatterns: readonly string[],
): ApprovalDecision['action'] {
  if (!approveEnabled) {
    return 'confirm';
  }

  if (!filePath || filePath.includes('\0')) {
    return 'deny';
  }

  const normalizedPath = normalizeSeparators(filePath);
  const action = resolveAllowDeny(allowedPatterns, deniedPatterns, (pat) => pat === '*' || matchesGlob(pat, normalizedPath));
  if (action !== 'confirm') {
    return action;
  }

  if (!cwd) {
    return 'confirm';
  }

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

  return 'confirm';
}

export function resolveCommandAction(
  command: string,
  approveEnabled: boolean,
  allowedPatterns: readonly string[],
  deniedPatterns: readonly string[],
): ApprovalDecision['action'] {
  if (!approveEnabled) {
    return 'confirm';
  }

  if (containsDangerousSubstitution(command)) {
    return 'confirm';
  }

  let subCommands: string[];
  try {
    subCommands = parseCommand(command);
  } catch {
    return 'confirm';
  }

  if (subCommands.length === 0) {
    return 'approve';
  }

  let hasConfirm = false;

  for (const subCmd of subCommands) {
    const decision = evaluateSubCommand(subCmd, allowedPatterns, deniedPatterns);
    if (decision === 'deny') {
      return 'deny';
    }
    if (decision === 'confirm') {
      hasConfirm = true;
    }
  }

  return hasConfirm ? 'confirm' : 'approve';
}

function evaluateSubCommand(subCmd: string, allowedPatterns: readonly string[], deniedPatterns: readonly string[]): ApprovalDecision['action'] {
  const decisionWithRedirection = getSingleCommandDecision(subCmd, allowedPatterns, deniedPatterns);
  if (decisionWithRedirection === 'deny') {
    return 'deny';
  }

  const cmdWithoutRedirection = subCmd.replace(/\d*>&\d*/g, '').trim();
  if (cmdWithoutRedirection === subCmd) {
    return decisionWithRedirection;
  }

  return getSingleCommandDecision(cmdWithoutRedirection, allowedPatterns, deniedPatterns);
}

export function parseCommand(command: string): string[] {
  if (!command || !command.trim()) {
    return [];
  }

  let tokens: unknown[];
  try {
    tokens = parse(command);
  } catch {
    throw new Error('Command could not be parsed into tokens.');
  }

  if (!Array.isArray(tokens)) {
    throw new Error('Command could not be parsed into tokens.');
  }

  const subCommands: string[] = [];
  let currentCommand: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (typeof token !== 'object' || token === null) {
      if (typeof token === 'string') {
        currentCommand.push(token);
      }
      continue;
    }

    const tok = token as Readonly<{
      op: string;
      pattern: string;
    }>;

    if ('comment' in tok) {
      continue;
    }

    const isOp = 'op' in tok && typeof tok.op === 'string';
    if (!isOp) {
      if ('pattern' in tok && typeof tok.pattern === 'string') {
        currentCommand.push(tok.pattern);
      }
      continue;
    }

    if (tok.op === 'glob' && 'pattern' in tok && typeof tok.pattern === 'string') {
      currentCommand.push(tok.pattern);
      continue;
    }

    const SEPARATOR_OPS = ['&&', '||', ';', '|', '&', '\n'];
    if (SEPARATOR_OPS.includes(tok.op)) {
      if (currentCommand.length > 0) {
        subCommands.push(currentCommand.join(' '));
        currentCommand = [];
      }
      continue;
    }

    currentCommand.push(tok.op);
  }

  if (currentCommand.length > 0) {
    subCommands.push(currentCommand.join(' '));
  }

  return subCommands;
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

function getSingleCommandDecision(
  command: string,
  allowedPatterns: readonly string[],
  deniedPatterns: readonly string[],
): ApprovalDecision['action'] {
  const trimmedCmd = command.trim();
  if (!trimmedCmd) {
    return 'approve';
  }

  const action = resolveAllowDeny(allowedPatterns, deniedPatterns, (pat) => matchesCommandPattern(pat, trimmedCmd));
  if (action !== 'confirm') {
    return action;
  }

  if (allowedPatterns.length === 0) {
    return 'approve';
  }

  return 'confirm';
}

function getSkillDirectories(cwd: string): readonly string[] {
  return [join(getAgentDir(), 'skills'), join(cwd, CONFIG_DIR_NAME, 'skills')];
}

function isInsideDirectory(target: string, dir: string): boolean {
  const normalizedTarget = normalizeSeparators(resolve(target)).replace(/\/+$/, '');
  const normalizedDir = normalizeSeparators(resolve(dir)).replace(/\/+$/, '');
  return normalizedTarget === normalizedDir || normalizedTarget.startsWith(`${normalizedDir}/`);
}

export function resolveReadPath(cwd: string, filePath: string, settings: AppSettings): ApprovalDecision['action'] {
  const normalizedPath = normalizeSeparators(filePath);
  const isDenied = settings.deniedReadPaths.some((pat) => pat === '*' || matchesGlob(pat, normalizedPath));
  if (isDenied) return 'deny';

  if (settings.autoApproveRead && settings.autoApproveSkillReads) {
    const resolved = resolve(cwd, filePath);
    const insideSkillDir = getSkillDirectories(cwd).some((dir) => isInsideDirectory(resolved, dir));
    if (insideSkillDir) return 'approve';
  }

  return resolvePathAction(cwd, filePath, settings.autoApproveRead, settings.allowedReadPaths, settings.deniedReadPaths);
}

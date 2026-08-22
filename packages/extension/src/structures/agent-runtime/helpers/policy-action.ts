import { join, resolve } from 'node:path';
import { CONFIG_DIR_NAME, getAgentDir, getCwdRelativePath, resolvePath } from '@earendil-works/pi-coding-agent';
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
  /\$\(/, // Command and arithmetic substitution
  /`/, // Backtick command substitution
  /<<<\s*(?:\$\(|`)/, // Here-string command substitutions
  /=\([^)]+\)/, // Zsh process substitution
  /[<>]\(/, // Bash and zsh process substitution
  /[*?+@!]\(e:[^:]+:\)/, // Zsh glob evaluation
  /\0/, // Null bytes
];

export function matchesGlob(pattern: string, filePath: string): boolean {
  if (!pattern || !filePath) return false;
  const normalizedFile = normalizeSeparators(filePath);
  return minimatch(normalizedFile, pattern, { nocase: true, dot: true });
}

function looksAbsolute(path: string): boolean {
  const normalized = normalizeSeparators(path);
  return normalized.startsWith('/') || /^[a-z]:\//i.test(normalized);
}

// Strips a Windows drive prefix so POSIX-style patterns compare against
// drive-rooted resolutions the same way on every platform.
function comparableForm(path: string): string {
  return normalizeSeparators(path).replace(/^[a-z]:/i, '');
}

// Patterns judge the same spellings a tool executor will act on. Absolute
// patterns (a leading "/" or drive letter, including an expanded "~") match
// the resolved location itself; relative patterns match workspace-facing
// spellings only, so "**/*.ts" can never bless "/etc/cron.d/x.ts". Denial is
// fail-closed: relative deny patterns also reach the resolved location.
function matchesPathForms(
  pattern: string,
  filePath: string,
  absoluteFile: string | undefined,
  insideRelative: string | undefined,
  denyBreadth: boolean,
): boolean {
  if (!pattern) return false;
  if (pattern === '*') return true;

  const expandedForm = normalizeSeparators(pattern.startsWith('~') ? resolvePath(pattern) : pattern);
  const patternForMatch = comparableForm(expandedForm);
  if (looksAbsolute(expandedForm)) {
    return absoluteFile !== undefined && matchesGlob(patternForMatch, comparableForm(absoluteFile));
  }

  // Workspace-facing spellings only: the raw input when relative, plus the
  // cwd-relative form of wherever it resolves.
  if (!looksAbsolute(filePath) && matchesGlob(patternForMatch, normalizeSeparators(filePath))) return true;
  if (insideRelative !== undefined && matchesGlob(patternForMatch, normalizeSeparators(insideRelative))) return true;
  // Denial is fail-closed, so deny patterns also reach the resolved location.
  return denyBreadth && absoluteFile !== undefined && matchesGlob(patternForMatch, comparableForm(absoluteFile));
}

function decidePathAction(
  cwd: string | undefined,
  filePath: string,
  allowedPatterns: readonly string[],
  deniedPatterns: readonly string[],
): ApprovalDecision['action'] {
  // One resolution shared by matching and by the tools themselves, so approval
  // and execution never see different paths for one input.
  const absoluteFile = cwd ? resolvePath(filePath, cwd) : undefined;
  const insideRelative = cwd && absoluteFile ? getCwdRelativePath(absoluteFile, resolve(cwd)) : undefined;

  if (deniedPatterns.some((pattern) => matchesPathForms(pattern, filePath, absoluteFile, insideRelative, true))) {
    return 'deny';
  }
  if (allowedPatterns.some((pattern) => matchesPathForms(pattern, filePath, absoluteFile, insideRelative, false))) {
    return 'approve';
  }

  if (insideRelative !== undefined) {
    return 'approve';
  }

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

  return decidePathAction(cwd, filePath, allowedPatterns, deniedPatterns);
}

export function resolveCommandAction(
  command: string,
  approveEnabled: boolean,
  allowedPatterns: readonly string[],
  deniedPatterns: readonly string[],
  tokenize: Tokenizer = parse,
): ApprovalDecision['action'] {
  if (!approveEnabled) {
    return 'confirm';
  }

  if (containsDangerousSubstitution(command)) {
    return 'confirm';
  }

  let subCommands: string[];
  try {
    subCommands = parseCommand(command, tokenize);
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

// Injectable for tests; production always uses shell-quote's parse.
type Tokenizer = (command: string) => unknown[];

export function parseCommand(command: string, tokenize: Tokenizer = parse): string[] {
  if (!command || !command.trim()) {
    return [];
  }

  let tokens: unknown[];
  try {
    tokens = tokenize(command);
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

  if (deniedPatterns.some((pat) => matchesCommandPattern(pat, trimmedCmd))) {
    return 'deny';
  }
  if (allowedPatterns.some((pat) => matchesCommandPattern(pat, trimmedCmd))) {
    return 'approve';
  }

  return 'confirm';
}

function getSkillDirectories(cwd: string): readonly string[] {
  return [join(getAgentDir(), 'skills'), join(cwd, CONFIG_DIR_NAME, 'skills')];
}

export function resolveReadPath(cwd: string, filePath: string, settings: AppSettings): ApprovalDecision['action'] {
  const base = decidePathAction(cwd, filePath, settings.allowedReadPaths, settings.deniedReadPaths);
  if (base === 'deny') {
    return 'deny';
  }

  if (!settings.autoApproveRead) {
    return 'confirm';
  }

  if (settings.autoApproveSkillReads) {
    const absoluteFile = resolvePath(filePath, cwd);
    const insideSkillDir = getSkillDirectories(cwd).some((dir) => getCwdRelativePath(absoluteFile, dir) !== undefined);
    if (insideSkillDir) return 'approve';
  }

  return base;
}

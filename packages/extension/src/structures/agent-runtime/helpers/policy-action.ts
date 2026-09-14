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
  // Parameter expansion flags.
  /\$\{([^}]*@[PQEAak][^}]*)\}/,
  // Escapes in parameter defaults.
  /\$\{([^}]*[=+\-?][^}]*\\(?:[0-7]{3}|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}))[^}]*\}/i,
  // Indirect parameter expansion.
  /\$\{![^}]+\}/,
  // Command and arithmetic substitution.
  /\$\(/,
  // Backtick command substitution.
  /`/,
  // Here-string command substitutions.
  /<<<\s*(?:\$\(|`)/,
  // Zsh process substitution.
  /=\([^)]+\)/,
  // Bash and zsh process substitution.
  /[<>]\(/,
  // Zsh glob evaluation.
  /[*?+@!]\(e:[^:]+:\)/,
  // Null bytes.
  /\0/,
];

export function containsDangerousSubstitution(source: string): boolean {
  if (!source) return false;
  if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(source))) {
    return true;
  }
  return process.platform === 'win32' && hasCaretQuoteEscape(source);
}

export function hasCaretQuoteEscape(source: string): boolean {
  // Cmd treats "^" outside double quotes as an escape character, so "^" can
  // terminate a quoted argument early and smuggle extra tokens past prefix matching.
  let inDoubleQuote = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === '^' && !inDoubleQuote && source[i + 1] === '"') {
      return true;
    }
  }
  return false;
}

const MAX_REGEX_PATTERN_LENGTH = 256;
const MAX_REGEX_INPUT_LENGTH = 8_192;

const UNSAFE_REGEX_PATTERNS: readonly RegExp[] = [
  // Lookahead / lookbehind.
  /\(\?[=!<]/,
  // Backreferences.
  /\\[1-9][0-9]*/,
  // Recursive / subroutine-style constructs.
  /\(\?(?:R|[+-]R|[0-9]+)\)/i,
  // A quantifier immediately followed by another quantifier.
  /(?:[+*?]|\{[0-9]+(?:,[0-9]*)?\})\s*(?:[+*?]|\{[0-9]+(?:,[0-9]*)?\})/,
  // A quantified group containing another quantifier, such as (a+)+ or (.*)+. This is intentionally conservative.
  /\((?:[^()\\]|\\.)*(?:[+*?]|\{[0-9]+(?:,[0-9]*)?\})(?:[^()\\]|\\.)*\)(?:[+*?]|\{[0-9]+(?:,[0-9]*)?\})/,
  // Ambiguous alternation under repetition, such as (a|aa)+.
  /\((?:[^()\\|]|\\.)*\|(?:[^()\\|]|\\.)*\)(?:[+*?]|\{[0-9]+(?:,[0-9]*)?\})/,
];

function isRegexPattern(pattern: string): boolean {
  return pattern.length >= 3 && pattern.startsWith('/') && pattern.endsWith('/');
}

function regexSource(pattern: string): string {
  return pattern.slice(1, -1);
}

function isSafeRegexPattern(source: string): boolean {
  if (!source || source.length > MAX_REGEX_PATTERN_LENGTH) {
    return false;
  }
  return !UNSAFE_REGEX_PATTERNS.some((pattern) => pattern.test(source));
}

function matchesRegexPattern(source: string, candidate: string): boolean {
  if (!isSafeRegexPattern(source) || candidate.length > MAX_REGEX_INPUT_LENGTH) {
    return false;
  }
  try {
    return new RegExp(source, 'i').test(candidate);
  } catch {
    return false;
  }
}

export function matchesGlob(pattern: string, filePath: string): boolean {
  if (!pattern || !filePath) return false;
  return minimatch(normalizeSeparators(filePath), pattern, { nocase: true, dot: true });
}

function looksAbsolute(path: string): boolean {
  const normalized = normalizeSeparators(path);
  return normalized.startsWith('/') || /^[a-z]:\//i.test(normalized);
}

function comparableForm(path: string): string {
  return normalizeSeparators(path).replace(/^[a-z]:/i, '');
}

function normalizePatternForPathMatch(pattern: string): { comparable: string; isAbsolute: boolean } {
  const expanded = pattern.startsWith('~') ? resolvePath(pattern) : pattern;
  return { comparable: comparableForm(expanded), isAbsolute: looksAbsolute(expanded) };
}

function matchesPathRegex(source: string, filePath: string, absoluteFile: string | undefined, insideRelative: string | undefined): boolean {
  const candidates = [
    normalizeSeparators(filePath),
    insideRelative !== undefined ? normalizeSeparators(insideRelative) : undefined,
    absoluteFile !== undefined ? comparableForm(absoluteFile) : undefined,
  ].filter((candidate): candidate is string => candidate !== undefined);
  return candidates.some((candidate) => matchesRegexPattern(source, candidate));
}

function matchesPathForms(pattern: string, filePath: string, absoluteFile: string | undefined, insideRelative: string | undefined): boolean {
  if (!pattern) return false;
  if (pattern === '*') return true;
  if (isRegexPattern(pattern)) {
    return matchesPathRegex(regexSource(pattern), filePath, absoluteFile, insideRelative);
  }

  const { comparable, isAbsolute } = normalizePatternForPathMatch(pattern);
  if (isAbsolute) {
    return absoluteFile !== undefined && matchesGlob(comparable, comparableForm(absoluteFile));
  }
  if (!looksAbsolute(filePath) && matchesGlob(comparable, normalizeSeparators(filePath))) {
    return true;
  }
  return insideRelative !== undefined && matchesGlob(comparable, normalizeSeparators(insideRelative));
}

function matchesResolvedSegments(pattern: string, absoluteFile: string): boolean {
  const { comparable, isAbsolute } = normalizePatternForPathMatch(pattern);
  if (isAbsolute) return false;

  const segments = comparableForm(absoluteFile).split('/').filter(Boolean);
  let suffix = '';
  for (let index = segments.length - 1; index >= 0; index--) {
    suffix = suffix === '' ? segments[index] : `${segments[index]}/${suffix}`;
    if (matchesGlob(comparable, suffix)) return true;
  }
  return false;
}

interface FileLocation {
  readonly absoluteFile: string | undefined;
  readonly insideRelative: string | undefined;
}

function resolveFileLocation(cwd: string | undefined, filePath: string): FileLocation {
  const absoluteFile = cwd ? resolvePath(filePath, cwd) : undefined;
  const insideRelative = cwd && absoluteFile ? getCwdRelativePath(absoluteFile, resolve(cwd)) : undefined;
  return { absoluteFile, insideRelative };
}

function isPathDenied(pattern: string, filePath: string, absoluteFile: string | undefined, insideRelative: string | undefined): boolean {
  if (matchesPathForms(pattern, filePath, absoluteFile, insideRelative)) return true;
  return !isRegexPattern(pattern) && absoluteFile !== undefined && matchesResolvedSegments(pattern, absoluteFile);
}

function decidePathAction(
  filePath: string,
  { absoluteFile, insideRelative }: FileLocation,
  allowedPatterns: readonly string[],
  deniedPatterns: readonly string[],
): ApprovalDecision['action'] {
  if (deniedPatterns.some((pattern) => isPathDenied(pattern, filePath, absoluteFile, insideRelative))) {
    return 'deny';
  }
  if (allowedPatterns.some((pattern) => matchesPathForms(pattern, filePath, absoluteFile, insideRelative))) {
    return 'approve';
  }
  return insideRelative !== undefined ? 'approve' : 'confirm';
}

export function resolvePathAction(
  cwd: string | undefined,
  filePath: string,
  approveEnabled: boolean,
  allowedPatterns: readonly string[],
  deniedPatterns: readonly string[],
): ApprovalDecision['action'] {
  if (!approveEnabled) return 'confirm';
  if (!filePath || filePath.includes('\0')) return 'deny';
  return decidePathAction(filePath, resolveFileLocation(cwd, filePath), allowedPatterns, deniedPatterns);
}

export type Tokenizer = (command: string) => unknown[];

const SEPARATOR_OPS = ['&&', '||', ';', '|', '&'];

function tokenize(command: string, tokenizer: Tokenizer): unknown[] {
  let tokens: unknown[];
  try {
    tokens = tokenizer(command);
  } catch {
    throw new Error('Command could not be parsed into tokens.');
  }
  if (!Array.isArray(tokens)) {
    throw new Error('Command could not be parsed into tokens.');
  }
  return tokens;
}

function parseCommandLine(command: string, tokenizer: Tokenizer): string[] {
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

export function parseCommand(command: string, tokenizer: Tokenizer = parse): string[] {
  return command.split(/\r?\n/).flatMap((line) => parseCommandLine(line, tokenizer));
}

function matchesCommandPattern(pattern: string, command: string): boolean {
  if (pattern === '*') return true;
  if (isRegexPattern(pattern)) {
    return matchesRegexPattern(regexSource(pattern), command);
  }

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
  if (!trimmedCmd) return 'approve';
  if (deniedPatterns.some((pattern) => matchesCommandPattern(pattern, trimmedCmd))) return 'deny';
  if (allowedPatterns.some((pattern) => matchesCommandPattern(pattern, trimmedCmd))) return 'approve';
  return 'confirm';
}

const FD_REDIRECT_PATTERN = /\d*>&\d*/g;

function evaluateSubCommand(subCmd: string, allowedPatterns: readonly string[], deniedPatterns: readonly string[]): ApprovalDecision['action'] {
  const decision = getSingleCommandDecision(subCmd, allowedPatterns, deniedPatterns);
  if (decision === 'deny') return decision;

  const withoutRedirection = subCmd.replace(FD_REDIRECT_PATTERN, '').trim();
  if (withoutRedirection === subCmd) return decision;

  return getSingleCommandDecision(withoutRedirection, allowedPatterns, deniedPatterns);
}

export function resolveCommandAction(
  command: string,
  approveEnabled: boolean,
  allowedPatterns: readonly string[],
  deniedPatterns: readonly string[],
  tokenizer: Tokenizer = parse,
): ApprovalDecision['action'] {
  if (!approveEnabled) return 'confirm';
  if (containsDangerousSubstitution(command)) return 'confirm';

  let subCommands: string[];
  try {
    subCommands = parseCommand(command, tokenizer);
  } catch {
    return 'confirm';
  }
  if (subCommands.length === 0) return 'approve';

  let hasConfirm = false;
  for (const subCmd of subCommands) {
    const decision = evaluateSubCommand(subCmd, allowedPatterns, deniedPatterns);
    if (decision === 'deny') return 'deny';
    if (decision === 'confirm') hasConfirm = true;
  }
  return hasConfirm ? 'confirm' : 'approve';
}

function getSkillDirectories(cwd: string): readonly string[] {
  return [join(getAgentDir(), 'skills'), join(cwd, CONFIG_DIR_NAME, 'skills')];
}

export function resolveReadPath(cwd: string, filePath: string, settings: AppSettings): ApprovalDecision['action'] {
  const location = resolveFileLocation(cwd, filePath);
  const base = decidePathAction(filePath, location, settings.allowedReadPaths, settings.deniedReadPaths);
  if (base === 'deny') return 'deny';
  if (!settings.autoApproveRead) return 'confirm';

  const { absoluteFile } = location;
  if (settings.autoApproveSkillReads && absoluteFile !== undefined) {
    const insideSkillDir = getSkillDirectories(cwd).some((dir) => getCwdRelativePath(absoluteFile, dir) !== undefined);
    if (insideSkillDir) return 'approve';
  }
  return base;
}

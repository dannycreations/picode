import { join, resolve } from 'node:path';
import { CONFIG_DIR_NAME, getAgentDir, getCwdRelativePath, resolvePath } from '@earendil-works/pi-coding-agent';
import { Minimatch } from 'minimatch';

import { parseCommand } from '@pi-code/shared/utilities/command';
import { isWindowsAbsolutePath, normalizeSeparators, setBounded } from '@pi-code/shared/utilities/common';

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

const PATTERN_CACHE_LIMIT = 256;
const regexCache = new Map<string, RegExp | null>();

function compiledRegex(source: string): RegExp | null {
  const cached = regexCache.get(source);
  if (cached !== undefined) return cached;

  let compiled: RegExp | null = null;
  if (isSafeRegexPattern(source)) {
    try {
      compiled = new RegExp(source, 'i');
    } catch {
      compiled = null;
    }
  }

  setBounded(regexCache, source, compiled, PATTERN_CACHE_LIMIT);
  return compiled;
}

function matchesRegexPattern(source: string, candidate: string): boolean {
  if (candidate.length > MAX_REGEX_INPUT_LENGTH) {
    return false;
  }
  const pattern = compiledRegex(source);
  if (!pattern) {
    return false;
  }
  return pattern.test(candidate);
}

const globCache = new Map<string, Minimatch>();

function globMatcher(pattern: string): Minimatch {
  let matcher = globCache.get(pattern);
  if (!matcher) {
    matcher = new Minimatch(pattern, { nocase: true, dot: true });
    setBounded(globCache, pattern, matcher, PATTERN_CACHE_LIMIT);
  }
  return matcher;
}

export function matchesGlob(pattern: string, filePath: string): boolean {
  if (!pattern || !filePath) return false;
  return globMatcher(pattern).match(normalizeSeparators(filePath));
}

function looksAbsolute(path: string): boolean {
  const normalized = normalizeSeparators(path);
  return normalized.startsWith('/') || isWindowsAbsolutePath(normalized);
}

function comparableForm(path: string): string {
  return normalizeSeparators(path).replace(/^[a-z]:/i, '');
}

interface NormalizedPattern {
  readonly comparable: string;
  readonly isAbsolute: boolean;
}

const normalizedPatternCache = new Map<string, NormalizedPattern>();

function normalizePatternForPathMatch(pattern: string): NormalizedPattern {
  const cached = normalizedPatternCache.get(pattern);
  if (cached) return cached;

  const expanded = pattern.startsWith('~') ? resolvePath(pattern) : pattern;
  const normalized: NormalizedPattern = { comparable: comparableForm(expanded), isAbsolute: looksAbsolute(expanded) };
  setBounded(normalizedPatternCache, pattern, normalized, PATTERN_CACHE_LIMIT);
  return normalized;
}

interface PathForms {
  readonly filePath: string;
  readonly normalizedFilePath: string;
  readonly absoluteFile: string | undefined;
  readonly comparableAbsolute: string | undefined;
  readonly normalizedRelative: string | undefined;
  readonly segments: readonly string[] | undefined;
}

function pathForms(filePath: string, absoluteFile: string | undefined, insideRelative: string | undefined): PathForms {
  const comparableAbsolute = absoluteFile !== undefined ? comparableForm(absoluteFile) : undefined;
  return {
    filePath,
    normalizedFilePath: normalizeSeparators(filePath),
    absoluteFile,
    comparableAbsolute,
    normalizedRelative: insideRelative !== undefined ? normalizeSeparators(insideRelative) : undefined,
    segments: comparableAbsolute !== undefined ? comparableAbsolute.split('/').filter(Boolean) : undefined,
  };
}

function matchesPathRegex(source: string, forms: PathForms): boolean {
  const candidates = [forms.normalizedFilePath, forms.normalizedRelative, forms.comparableAbsolute];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    if (matchesRegexPattern(source, candidate)) return true;
  }
  return false;
}

function matchesPathForms(pattern: string, forms: PathForms): boolean {
  if (!pattern) return false;
  if (pattern === '*') return true;
  if (isRegexPattern(pattern)) {
    return matchesPathRegex(regexSource(pattern), forms);
  }

  const { comparable, isAbsolute } = normalizePatternForPathMatch(pattern);
  if (isAbsolute) {
    return forms.comparableAbsolute !== undefined && matchesGlob(comparable, forms.comparableAbsolute);
  }
  if (!looksAbsolute(forms.filePath) && matchesGlob(comparable, forms.normalizedFilePath)) {
    return true;
  }
  return forms.normalizedRelative !== undefined && matchesGlob(comparable, forms.normalizedRelative);
}

function matchesResolvedSegments(pattern: string, forms: PathForms): boolean {
  const { comparable, isAbsolute } = normalizePatternForPathMatch(pattern);
  if (isAbsolute) return false;

  const segments = forms.segments;
  if (!segments) return false;

  let suffix = '';
  for (let index = segments.length - 1; index >= 0; index--) {
    suffix = suffix === '' ? segments[index] : `${segments[index]}/${suffix}`;
    if (matchesGlob(comparable, suffix)) return true;
  }
  return false;
}

export interface FileLocation {
  readonly filePath: string;
  readonly absoluteFile: string | undefined;
  readonly insideRelative: string | undefined;
}

export function resolveFileLocation(cwd: string | undefined, filePath: string): FileLocation {
  const absoluteFile = cwd ? resolvePath(filePath, cwd) : undefined;
  const insideRelative = cwd && absoluteFile ? getCwdRelativePath(absoluteFile, resolve(cwd)) : undefined;
  return { filePath, absoluteFile, insideRelative };
}

function isPathDenied(pattern: string, forms: PathForms): boolean {
  if (matchesPathForms(pattern, forms)) return true;
  return !isRegexPattern(pattern) && forms.absoluteFile !== undefined && matchesResolvedSegments(pattern, forms);
}

function decidePathAction(location: FileLocation, allowedPatterns: readonly string[], deniedPatterns: readonly string[]): ApprovalDecision['action'] {
  const forms = pathForms(location.filePath, location.absoluteFile, location.insideRelative);

  if (deniedPatterns.some((pattern) => isPathDenied(pattern, forms))) {
    return 'deny';
  }
  if (allowedPatterns.some((pattern) => matchesPathForms(pattern, forms))) {
    return 'approve';
  }
  return location.insideRelative !== undefined ? 'approve' : 'confirm';
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
  return decidePathAction(resolveFileLocation(cwd, filePath), allowedPatterns, deniedPatterns);
}

const loweredPatternCache = new Map<string, string>();

function loweredPattern(pattern: string): string {
  let lowered = loweredPatternCache.get(pattern);
  if (lowered === undefined) {
    lowered = pattern.toLowerCase();
    setBounded(loweredPatternCache, pattern, lowered, PATTERN_CACHE_LIMIT);
  }
  return lowered;
}

function matchesCommandPattern(pattern: string, command: string, commandLower: string): boolean {
  if (pattern === '*') return true;
  if (isRegexPattern(pattern)) {
    return matchesRegexPattern(regexSource(pattern), command);
  }

  const pLower = loweredPattern(pattern);
  if (pLower === commandLower) return true;
  if (pLower.includes('*') || pLower.includes('?')) {
    return matchesGlob(pLower, commandLower);
  }
  if (commandLower.startsWith(pLower)) {
    const nextChar = commandLower.charAt(pLower.length);
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

  const commandLower = trimmedCmd.toLowerCase();
  if (deniedPatterns.some((pattern) => matchesCommandPattern(pattern, trimmedCmd, commandLower))) return 'deny';
  if (allowedPatterns.some((pattern) => matchesCommandPattern(pattern, trimmedCmd, commandLower))) return 'approve';
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
): ApprovalDecision['action'] {
  if (!approveEnabled) return 'confirm';
  if (containsDangerousSubstitution(command)) return 'confirm';

  let subCommands: string[];
  try {
    subCommands = parseCommand(command);
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
  const base = decidePathAction(location, settings.allowedReadPaths, settings.deniedReadPaths);
  if (base === 'deny') return 'deny';
  if (!settings.autoApproveRead) return 'confirm';

  const { absoluteFile } = location;
  if (settings.autoApproveSkillReads && absoluteFile !== undefined) {
    const insideSkillDir = getSkillDirectories(cwd).some((dir) => getCwdRelativePath(absoluteFile, dir) !== undefined);
    if (insideSkillDir) return 'approve';
  }
  return base;
}

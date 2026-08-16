import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative, resolve } from 'node:path';

const packageDir = resolve(import.meta.dirname, '..');
const sharedDir = join(packageDir, 'src', 'shared');

const NODE_BUILTINS = new Set(builtinModules);

const TYPE_ONLY_IMPORT = /(?:import|export)\s+type\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
const VALUE_IMPORT = /(?:import|export)\b(?!\s+type\b)[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT = /^\s*import\s*['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly specifier: string;
  readonly reason: string;
}

function isVscodeModule(specifier: string): boolean {
  return specifier === 'vscode' || specifier.startsWith('vscode/');
}

function isNodeModule(specifier: string): boolean {
  return specifier.startsWith('node:') || NODE_BUILTINS.has(specifier);
}

function lineNumberOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function listTypeScriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTypeScriptFiles(full));
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(file: string, violations: Violation[]): void {
  const source = readFileSync(file, 'utf8');

  const check = (regex: RegExp, typeOnly: boolean): void => {
    for (const match of source.matchAll(regex)) {
      const specifier = match[1];
      if (isVscodeModule(specifier)) {
        violations.push({
          file,
          line: lineNumberOf(source, match.index),
          specifier,
          reason: 'vscode API is extension-only and unavailable in the webview',
        });
        continue;
      }
      if (isNodeModule(specifier) && !typeOnly) {
        violations.push({ file, line: lineNumberOf(source, match.index), specifier, reason: 'node builtin must be imported as `import type` only' });
      }
    }
  };

  check(TYPE_ONLY_IMPORT, true);
  check(VALUE_IMPORT, false);
  check(SIDE_EFFECT_IMPORT, false);
  check(DYNAMIC_IMPORT, false);
}

const files = listTypeScriptFiles(sharedDir);
const violations: Violation[] = [];
for (const file of files) scanFile(file, violations);

if (violations.length > 0) {
  console.error(`Shared module is not platform-agnostic (${violations.length} issue(s)):`);
  for (const { file, line, specifier, reason } of violations) {
    console.error(`  ${relative(process.cwd(), file)}:${line}  import '${specifier}' — ${reason}`);
  }
  process.exit(1);
}

console.log('Shared module is platform-agnostic.');

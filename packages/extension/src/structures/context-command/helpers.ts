import { Range } from 'vscode';

import { toRelativePath } from '@pi-code/extension/utilities/vscode';

import type { Diagnostic, Selection, TextDocument } from 'vscode';

interface EffectiveSelection {
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}

export function getEffectiveSelection(document: TextDocument, selection: Selection): EffectiveSelection | null {
  if (!selection.isEmpty) {
    return {
      startLine: selection.start.line,
      endLine: selection.end.line,
      text: document.getText(selection),
    };
  }

  const cursorLine = document.lineAt(selection.start.line);
  if (cursorLine.isEmptyOrWhitespace) {
    return null;
  }

  const lastLine = document.lineCount - 1;
  const startLine = Math.max(0, cursorLine.lineNumber - 1);
  const endLine = Math.min(lastLine, cursorLine.lineNumber + 1);
  const range = document.validateRange(new Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER));
  return {
    startLine: range.start.line,
    endLine: range.end.line,
    text: document.getText(range),
  };
}

export interface MappedDiagnostic {
  readonly message: string;
  readonly source: string | undefined;
  readonly code: string | number | undefined;
}

export function mapDiagnostics(diagnostics: readonly Diagnostic[]): MappedDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    message: diagnostic.message,
    source: diagnostic.source,
    code:
      diagnostic.code !== undefined && diagnostic.code !== null
        ? typeof diagnostic.code === 'object'
          ? diagnostic.code.value
          : diagnostic.code
        : undefined,
  }));
}

export interface ResolvedSelection {
  readonly filePath: string;
  readonly selectedText: string;
  readonly startLine: number;
  readonly endLine: number;
}

export function resolveSelectionFromDocument(document: TextDocument, selection: Selection): ResolvedSelection | null {
  const effective = getEffectiveSelection(document, selection);
  if (!effective) return null;

  return {
    filePath: toRelativePath(document.uri),
    startLine: effective.startLine + 1,
    endLine: effective.endLine + 1,
    selectedText: effective.text,
  };
}

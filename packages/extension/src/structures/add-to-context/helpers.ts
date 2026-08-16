import { Range } from 'vscode';

import { toRelativePath } from '@pi-code/extension/utilities/vscode';

import type { Diagnostic, Selection, TextDocument } from 'vscode';

interface EffectiveSelection {
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}

interface SelectionContext {
  readonly filePath: string;
  readonly selection: EffectiveSelection;
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

  const range = document.validateRange(new Range(cursorLine.lineNumber - 1, 0, cursorLine.lineNumber + 1, Number.MAX_SAFE_INTEGER));
  return {
    startLine: range.start.line,
    endLine: range.end.line,
    text: document.getText(range),
  };
}

export function getSelectionContext(document: TextDocument, selection: Selection): SelectionContext | null {
  const effective = getEffectiveSelection(document, selection);
  if (!effective) return null;
  return { filePath: toRelativePath(document.uri), selection: effective };
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

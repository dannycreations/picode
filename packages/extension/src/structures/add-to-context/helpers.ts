import { Range } from 'vscode';

import type { Selection, TextDocument } from 'vscode';

export interface EffectiveSelection {
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

  const range = document.validateRange(new Range(cursorLine.lineNumber - 1, 0, cursorLine.lineNumber + 1, Number.MAX_SAFE_INTEGER));
  return {
    startLine: range.start.line,
    endLine: range.end.line,
    text: document.getText(range),
  };
}

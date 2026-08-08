import { logger } from '@pi-code/shared/core/logger';

export function getEffectiveSelection(
  document: {
    readonly lineCount: number;
    lineAt(line: number): { readonly text: string; readonly lineNumber: number };
    getText(range?: {
      readonly start: { readonly line: number; readonly character: number };
      readonly end: { readonly line: number; readonly character: number };
    }): string;
  },
  selection: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  },
): { readonly startLine: number; readonly endLine: number; readonly text: string } | null {
  try {
    const selectedText = document.getText(selection);
    if (selectedText) {
      return {
        startLine: selection.start.line,
        endLine: selection.end.line,
        text: selectedText,
      };
    }

    const currentLine = document.lineAt(selection.start.line);
    if (!currentLine.text.trim()) {
      return null;
    }

    const startLineIndex = Math.max(0, currentLine.lineNumber - 1);
    const endLineIndex = Math.min(document.lineCount - 1, currentLine.lineNumber + 1);

    const endLineLength = document.lineAt(endLineIndex).text.length;
    const range = {
      start: { line: startLineIndex, character: 0 },
      end: { line: endLineIndex, character: endLineLength },
    };

    return {
      startLine: startLineIndex,
      endLine: endLineIndex,
      text: document.getText(range),
    };
  } catch (error) {
    logger.error('Error getting effective selection:', error);
    return null;
  }
}

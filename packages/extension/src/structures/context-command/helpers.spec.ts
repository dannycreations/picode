import { describe, expect, it, vi } from 'vitest';

import { getEffectiveSelection } from '@pi-code/extension/structures/context-command/helpers';

vi.mock('vscode', () => {
  class MockRange {
    public start: { line: number; character: number };
    public end: { line: number; character: number };
    constructor(startLine: number, startChar: number, endLine: number, endChar: number) {
      this.start = { line: startLine, character: startChar };
      this.end = { line: endLine, character: endChar };
    }
  }
  return { Range: MockRange };
});

function mockDocument(lineCount: number, lines: Array<{ isEmptyOrWhitespace: boolean }>) {
  return {
    lineCount,
    lineAt: (line: number) => ({ lineNumber: line, ...lines[line] }),
    validateRange: (range: any) => range,
    getText: () => 'code',
  } as any;
}

describe('getEffectiveSelection', () => {
  it('does not throw when the cursor is on the first line (empty selection)', () => {
    const document = mockDocument(5, [
      { isEmptyOrWhitespace: false },
      { isEmptyOrWhitespace: false },
      { isEmptyOrWhitespace: false },
      { isEmptyOrWhitespace: false },
      { isEmptyOrWhitespace: false },
    ]);
    const selection = { isEmpty: true, start: { line: 0 }, end: { line: 0 } } as any;

    const result = getEffectiveSelection(document, selection);

    expect(result).not.toBeNull();
    expect(result?.startLine).toBe(0);
    expect(result?.endLine).toBe(1);
  });
});

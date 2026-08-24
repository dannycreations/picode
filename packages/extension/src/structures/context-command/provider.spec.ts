import { describe, expect, it, vi } from 'vitest';

import { PiCodeActionProvider } from './provider';

vi.mock('vscode', () => {
  class MockSelection {
    public get isEmpty() {
      return false;
    }
    constructor(
      public start: { line: number },
      public end: { line: number },
    ) {}
  }
  class MockRange {
    constructor(
      public start: any,
      public end: any,
    ) {}
  }
  class MockCodeAction {
    public command: any;
    public isPreferred: boolean = false;
    constructor(
      public title: string,
      public kind: any,
    ) {}
  }
  return {
    Selection: MockSelection,
    Range: MockRange,
    CodeAction: MockCodeAction,
    CodeActionKind: {
      QuickFix: 'quickfix',
      RefactorRewrite: 'refactorrewrite',
    },
    workspace: {
      asRelativePath: (uri: any) => uri.fsPath,
    },
    Uri: {
      file: (path: string) => ({ fsPath: path, path }),
    },
  };
});

vi.mock('@pi-code/extension/utilities/vscode', () => {
  return {
    toRelativePath: (uri: any) => uri.fsPath,
  };
});

describe('PiCodeActionProvider', () => {
  it('should return add to context action, and fix action if diagnostics are present', () => {
    const provider = new PiCodeActionProvider();
    const mockDocument = {
      uri: { fsPath: 'test.ts' },
      getText: () => 'some code',
    } as any;
    const mockSelection = {
      isEmpty: false,
      start: { line: 0 },
      end: { line: 1 },
    } as any;
    const mockContext = {
      diagnostics: [
        {
          message: 'Error message',
          source: 'TS',
          code: '2552',
        },
      ],
    } as any;

    const actions = provider.provideCodeActions(mockDocument, mockSelection, mockContext, {} as any);

    expect(actions).toHaveLength(2);
    expect(actions[0].title).toBe('Add to Pi Context');
    expect(actions[0].command?.command).toBe('pi-code.addToContext');
    expect(actions[0].command?.arguments).toEqual([{ filePath: 'test.ts', selectedText: 'some code', startLine: 1, endLine: 2 }]);

    expect(actions[1].title).toBe('Add to Pi Context');
    expect(actions[1].command?.command).toBe('pi-code.addProblemToContext');
    expect(actions[1].command?.arguments).toEqual([
      { filePath: 'test.ts', selectedText: 'some code', startLine: 1, endLine: 2 },
      [
        {
          message: 'Error message',
          source: 'TS',
          code: '2552',
        },
      ],
    ]);
  });
});

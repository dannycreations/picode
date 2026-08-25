import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMAND_IDS } from '@pi-code/shared/core/constants';
import { registerAddToContextCommand, registerFillCodeCommand } from './command';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  editor: { current: null as any },
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  withProgress: vi.fn(),
  resolveSelectionFromDocument: vi.fn(),
  mapDiagnostics: vi.fn(),
  getWorkspaceCwd: vi.fn(),
  reportError: vi.fn(),
  completeAndExtract: vi.fn(),
  executeCommand: vi.fn(),
  postMessage: vi.fn(),
}));

vi.mock('vscode', () => ({
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(id, handler);
      return { dispose: () => mocks.handlers.delete(id) };
    },
    executeCommand: mocks.executeCommand,
  },
  languages: {
    getDiagnostics: () => [],
  },
  ProgressLocation: { Notification: 15 },
  Range: class {
    constructor(
      public startLine: unknown,
      public startCharacter: unknown,
      public endLine: unknown,
      public endCharacter: unknown,
    ) {}
  },
  window: {
    get activeTextEditor() {
      return mocks.editor.current;
    },
    showErrorMessage: mocks.showErrorMessage,
    showInformationMessage: mocks.showInformationMessage,
    showWarningMessage: mocks.showWarningMessage,
    withProgress: mocks.withProgress,
  },
}));

vi.mock('@pi-code/extension/core/prompt', () => ({ FILL_CODE_PROMPT: 'FILL_PROMPT', FIX_CODE_PROMPT: 'FIX_PROMPT' }));

vi.mock('@pi-code/extension/structures/agent-runtime/helpers/complete', () => ({
  completeAndExtract: mocks.completeAndExtract,
}));

vi.mock('@pi-code/extension/structures/context-command/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./helpers')>()),
  mapDiagnostics: mocks.mapDiagnostics,
  resolveSelectionFromDocument: mocks.resolveSelectionFromDocument,
}));

vi.mock('@pi-code/extension/utilities/vscode', () => ({
  getWorkspaceCwd: mocks.getWorkspaceCwd,
  reportError: mocks.reportError,
}));

interface Replacement {
  readonly range: unknown;
  readonly text: string;
}

function createEditor() {
  const replacements: Replacement[] = [];
  return {
    replacements,
    document: {
      lineCount: 2,
      lineAt: () => ({ text: 'line' }),
    },
    edit: vi.fn(async (builder: (b: { replace: (range: unknown, text: string) => void }) => void) => {
      builder({
        replace: (range, text) => {
          replacements.push({ range, text });
        },
      });
      return true;
    }),
  };
}

function createToken() {
  const callbacks: Array<() => void> = [];
  return {
    token: {
      onCancellationRequested: (callback: () => void) => {
        callbacks.push(callback);
        return {};
      },
    },
    fireCancel: () => {
      for (const callback of callbacks) callback();
    },
  };
}

type ProgressTask = (progress: unknown, token: ReturnType<typeof createToken>['token']) => Promise<unknown>;

async function runFillCommand(): Promise<void> {
  const handler = mocks.handlers.get(COMMAND_IDS.fillCode);
  if (!handler) throw new Error(`${COMMAND_IDS.fillCode} is not registered`);
  await handler([]);
}

async function runAddToContext(args: unknown[]): Promise<void> {
  const handler = mocks.handlers.get(COMMAND_IDS.addToContext);
  if (!handler) throw new Error(`${COMMAND_IDS.addToContext} is not registered`);
  await handler(...args);
}

describe('addToContext argument handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.editor.current = createEditor();
    mocks.resolveSelectionFromDocument.mockReturnValue({ filePath: 'test.ts', selectedText: 'old code', startLine: 1, endLine: 2 });
    registerAddToContextCommand({ postMessage: mocks.postMessage } as never);
  });

  it('falls back to the active editor when a menu passes a Uri instead of a selection', async () => {
    // Editor/context menus deliver the document Uri as the first argument.
    await runAddToContext([{ $mid: 1, fsPath: '/ws/test.ts', path: '/ws/test.ts', scheme: 'file' }]);

    expect(mocks.resolveSelectionFromDocument).toHaveBeenCalled();
    expect(mocks.postMessage).toHaveBeenCalledWith({
      type: 'set_chat_input',
      payload: { text: 'test.ts:1-2\n```\nold code\n```\n\n' },
    });
  });

  it('uses the selection passed by the code action unchanged', async () => {
    const passed = { filePath: 'other.ts', selectedText: 'kept', startLine: 3, endLine: 4 };
    await runAddToContext([passed]);

    expect(mocks.resolveSelectionFromDocument).not.toHaveBeenCalled();
    expect(mocks.postMessage).toHaveBeenCalledWith({
      type: 'set_chat_input',
      payload: { text: 'other.ts:3-4\n```\nkept\n```\n\n' },
    });
  });
});

describe('runInlineCompletion cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.editor.current = createEditor();
    mocks.getWorkspaceCwd.mockReturnValue('/ws');
    mocks.resolveSelectionFromDocument.mockReturnValue({ filePath: 'test.ts', selectedText: 'old code', startLine: 1, endLine: 2 });
    mocks.mapDiagnostics.mockImplementation((diagnostics: readonly unknown[]) => [...diagnostics]);
    mocks.withProgress.mockImplementation(async (_options: unknown, task: ProgressTask) => task({}, createToken().token));
    registerFillCodeCommand();
  });

  it('passes an abort signal and applies the generated replacement', async () => {
    mocks.completeAndExtract.mockResolvedValue('generated code');

    await runFillCommand();

    expect(mocks.completeAndExtract).toHaveBeenCalledWith('/ws', expect.stringContaining('FILL_PROMPT'), expect.any(AbortSignal));
    expect(mocks.editor.current.replacements).toEqual([{ range: expect.anything(), text: 'generated code' }]);
    expect(mocks.showInformationMessage).not.toHaveBeenCalled();
  });

  it('does not apply the replacement when cancelled after the response arrives', async () => {
    mocks.withProgress.mockImplementation(async (_options: unknown, task: ProgressTask) => {
      const handle = createToken();
      const running = task({}, handle.token);
      handle.fireCancel();
      return running;
    });
    // The response lands even though the user cancelled; the guard must drop it.
    mocks.completeAndExtract.mockResolvedValue('late code');

    await runFillCommand();

    expect(mocks.editor.current.replacements).toHaveLength(0);
    expect(mocks.showInformationMessage).toHaveBeenCalledWith('Code generation cancelled.');
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    expect(mocks.reportError).not.toHaveBeenCalled();
  });

  it('reports no error when the model request rejects because of the cancel', async () => {
    mocks.withProgress.mockImplementation(async (_options: unknown, task: ProgressTask) => {
      const handle = createToken();
      const running = task({}, handle.token);
      handle.fireCancel();
      return running;
    });
    mocks.completeAndExtract.mockImplementation(async (_cwd: string, _prompt: string, signal?: AbortSignal) => {
      if (signal?.aborted) throw new Error('This operation was aborted');
      return 'unreachable';
    });

    await runFillCommand();

    expect(mocks.reportError).not.toHaveBeenCalled();
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
    expect(mocks.showInformationMessage).toHaveBeenCalledWith('Code generation cancelled.');
    expect(mocks.editor.current.replacements).toHaveLength(0);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerCommitMessageCommands } from '@pi-code/extension/structures/commit-message/command';
import { COMMAND_IDS } from '@pi-code/shared/core/constants';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  executeCommand: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  withProgress: vi.fn(),
  getGitRepository: vi.fn(),
  getWorkspaceUri: vi.fn(),
  reportError: vi.fn(),
  getGitChanges: vi.fn(),
  getGitDiffContext: vi.fn(),
  getRepoContext: vi.fn(),
  buildGitContext: vi.fn(),
  completeAndExtract: vi.fn(),
}));

vi.mock('vscode', () => ({
  commands: {
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(id, handler);
      return { dispose: () => mocks.handlers.delete(id) };
    },
    executeCommand: mocks.executeCommand,
  },
  Disposable: {
    from: (...disposables: Array<{ dispose(): void }>) =>
      ({
        dispose: () => disposables.forEach((disposable) => disposable.dispose()),
      }) as never,
  },
  ProgressLocation: { SourceControl: 2 },
  window: {
    withProgress: mocks.withProgress,
    showInformationMessage: mocks.showInformationMessage,
    showErrorMessage: mocks.showErrorMessage,
  },
  workspace: {
    getConfiguration: () => ({
      get: () => undefined,
    }),
  },
}));

vi.mock('@pi-code/extension/core/prompt', () => ({ COMMIT_MESSAGE_PROMPT: 'PROMPT' }));

vi.mock('@pi-code/extension/structures/agent-runtime/helpers/complete', () => ({
  completeAndExtract: mocks.completeAndExtract,
}));

vi.mock('@pi-code/extension/structures/commit-message/git', () => ({
  getGitChanges: mocks.getGitChanges,
  getGitDiffContext: mocks.getGitDiffContext,
  getRepoContext: mocks.getRepoContext,
  buildGitContext: mocks.buildGitContext,
}));

vi.mock('@pi-code/extension/utilities/git', () => ({ getGitRepository: mocks.getGitRepository }));

vi.mock('@pi-code/extension/utilities/vscode', () => ({
  getWorkspaceUri: mocks.getWorkspaceUri,
  reportError: mocks.reportError,
}));

vi.mock('@pi-code/shared/core/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const repo = {
  rootUri: { fsPath: '/repo' },
  inputBox: { value: '' },
};

let generate: (...args: unknown[]) => Promise<unknown>;
let cancelGeneration: (...args: unknown[]) => unknown;

beforeEach(() => {
  mocks.handlers.clear();
  vi.clearAllMocks();
  repo.inputBox.value = '';

  mocks.getGitRepository.mockResolvedValue(repo);
  mocks.getWorkspaceUri.mockReturnValue(repo.rootUri);
  mocks.getGitChanges.mockResolvedValue({
    changes: [{ relativePath: 'a.ts', absolutePath: '/repo/a.ts', isStaged: false, isUntracked: false, isDeleted: false }],
    useStaged: false,
  });
  mocks.getGitDiffContext.mockResolvedValue('');
  mocks.getRepoContext.mockResolvedValue({ branch: 'main', recentCommits: '' });
  mocks.buildGitContext.mockReturnValue('GIT_CONTEXT');
  mocks.withProgress.mockImplementation(async (_options: unknown, callback: (progress: unknown, token: unknown) => Promise<unknown>) =>
    callback({}, { onCancellationRequested: vi.fn() }),
  );

  registerCommitMessageCommands();
  generate = mocks.handlers.get(COMMAND_IDS.generateCommitMessage) as typeof generate;
  cancelGeneration = mocks.handlers.get(COMMAND_IDS.cancelGenerateCommitMessage) as typeof cancelGeneration;
});

function flushTasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function contextKeyCalls(): Array<[string, boolean]> {
  return mocks.executeCommand.mock.calls.filter((call) => call[0] === 'setContext').map((call) => [call[1] as string, call[2] as boolean]);
}

describe('generate commit message cancellation', () => {
  it('applies the generated message and toggles the generating context key', async () => {
    const gate = deferred<string>();
    mocks.completeAndExtract.mockReturnValue(gate.promise);

    const running = generate(undefined);
    gate.resolve('feat: add widget');
    await running;

    expect(repo.inputBox.value).toBe('feat: add widget');
    expect(contextKeyCalls()).toEqual([
      ['pi-code.commitMessageGenerating', true],
      ['pi-code.commitMessageGenerating', false],
    ]);
    expect(mocks.withProgress).toHaveBeenCalledWith(expect.objectContaining({ cancellable: true }), expect.any(Function));
    expect(mocks.reportError).not.toHaveBeenCalled();
  });

  it('ignores a second request while a generation is already running', async () => {
    const gate = deferred<string>();
    mocks.completeAndExtract.mockReturnValue(gate.promise);

    const first = generate(undefined);
    await flushTasks();

    await generate(undefined);

    expect(mocks.completeAndExtract).toHaveBeenCalledTimes(1);

    gate.resolve('feat: done');
    await first;

    expect(repo.inputBox.value).toBe('feat: done');
  });

  it('discards an in-flight result when cancelled and returns to idle state', async () => {
    const gate = deferred<string>();
    mocks.completeAndExtract.mockReturnValue(gate.promise);

    const running = generate(undefined);
    await flushTasks();

    cancelGeneration({ rootUri: { fsPath: '/repo' } });
    gate.resolve('feat: should be discarded');
    await running;

    expect(repo.inputBox.value).toBe('');
    expect(mocks.showInformationMessage).toHaveBeenCalledWith('Commit message generation cancelled.');
    expect(mocks.reportError).not.toHaveBeenCalled();
    expect(contextKeyCalls().at(-1)).toEqual(['pi-code.commitMessageGenerating', false]);
  });

  it('does nothing when cancelled while no generation is active', () => {
    expect(() => cancelGeneration(undefined)).not.toThrow();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPolicyExtension } from '@pi-code/extension/structures/agent-runtime/policy';
import { coerceSetting, SETTING_KEYS } from '@pi-code/shared/core/settings';

import type { AppSettings } from '@pi-code/shared/core/settings';

const mocks = vi.hoisted(() => ({
  requestApproval: vi.fn(),
  getSubagentSession: vi.fn(),
  recordApprovalDuration: vi.fn(),
}));

vi.mock('@pi-code/extension/core/settings', () => ({
  readAppSettings: () => activeSettings,
}));

vi.mock('@pi-code/extension/structures/agent-runtime/brokers/approval', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pi-code/extension/structures/agent-runtime/brokers/approval')>()),
  requestApproval: mocks.requestApproval,
}));

vi.mock('@pi-code/extension/structures/agent-runtime/brokers/tool-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pi-code/extension/structures/agent-runtime/brokers/tool-call')>()),
  getSubagentSession: mocks.getSubagentSession,
  recordApprovalDuration: mocks.recordApprovalDuration,
}));

// Defaults materialized the same way readAppSettings builds them.
const DEFAULT_SETTINGS = Object.fromEntries(SETTING_KEYS.map((key) => [key, coerceSetting(key, undefined)])) as AppSettings;

// Replaced wholesale by each scenario; never mutated in place.
let activeSettings: AppSettings;

beforeEach(() => {
  activeSettings = DEFAULT_SETTINGS;
  mocks.requestApproval.mockReset();
  mocks.getSubagentSession.mockReset();
  mocks.recordApprovalDuration.mockReset();
  mocks.requestApproval.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

type ToolCallResult = { block: boolean; reason?: string };

function installPolicy(): (event: { toolName: string; toolCallId?: string; input?: unknown }, ctx: unknown) => Promise<ToolCallResult> {
  let handler!: (event: { toolName: string; toolCallId?: string; input?: unknown }, ctx: unknown) => Promise<ToolCallResult>;
  const pi = {
    on: (_hook: string, fn: unknown) => {
      handler = fn as typeof handler;
    },
  };
  const extension = createPolicyExtension();
  // InlineExtension is a union; some extensions are bare factory functions.
  const factory = typeof extension === 'function' ? extension : extension.factory.bind(extension);
  factory(pi as never);
  return handler;
}

async function decide(toolName: string, input?: unknown, options: { cwd?: string; toolCallId?: string } = {}): Promise<ToolCallResult> {
  const handler = installPolicy();
  return handler(
    { toolName, input, toolCallId: options.toolCallId },
    { cwd: options.cwd ?? '/workspace', sessionManager: { getSessionId: () => 'session-1' } },
  );
}

describe('createPolicyExtension tool_call gating', () => {
  it('approves self-approving tools without consulting the presenter', async () => {
    for (const toolName of ['update_todo', 'ask_question', 'spawn_subagent']) {
      expect(await decide(toolName)).toEqual({ block: false });
    }
    expect(mocks.requestApproval).not.toHaveBeenCalled();
  });

  it('reads write_file paths from args.path and edit_file paths from args.file_path', async () => {
    activeSettings = { ...DEFAULT_SETTINGS, autoApproveWrite: true, allowedWritePaths: ['docs/**'] };

    expect(await decide('write_file', { path: 'docs/a.md' })).toEqual({ block: false });
    expect(await decide('edit_file', { file_path: 'docs/b.md' })).toEqual({ block: false });
    expect(mocks.requestApproval).not.toHaveBeenCalled();

    // A swapped or missing field must fail closed instead of approving nothing.
    expect(await decide('write_file', {})).toEqual({
      block: true,
      reason: 'Access to write/edit this file path is explicitly denied by settings.',
    });
    expect(await decide('edit_file', { path: 'docs/c.md' })).toEqual({
      block: true,
      reason: 'Access to write/edit this file path is explicitly denied by settings.',
    });
  });

  it('denies a whole multi-file read when one listed path hits the deny glob', async () => {
    activeSettings = { ...DEFAULT_SETTINGS, autoApproveRead: true, allowedReadPaths: ['**'], deniedReadPaths: ['**/.env'] };

    expect(await decide('read_file', { files: [{ path: 'a.ts' }, { path: '.env' }] })).toEqual({
      block: true,
      reason: 'Access to read one or more specified paths is explicitly denied by settings.',
    });
    expect(await decide('read_file', { files: [{ path: 'a.ts' }, { path: 'b.ts' }] })).toEqual({ block: false });
  });

  it('keeps a name-rooted read deny in force when a path escapes the workspace under yolo', async () => {
    activeSettings = {
      ...DEFAULT_SETTINGS,
      autoApproveRead: true,
      allowedReadPaths: ['**'],
      deniedReadPaths: ['.env'],
      yolo: true,
      yoloRespectDenied: true,
    };

    expect(await decide('read_file', { files: [{ path: '../elsewhere/.env' }] })).toEqual({
      block: true,
      reason: 'Access to read one or more specified paths is explicitly denied by settings.',
    });
    expect(mocks.requestApproval).not.toHaveBeenCalled();
  });

  it('hands mixed read decisions to the user with the delegating agent labeled', async () => {
    mocks.getSubagentSession.mockReturnValue({ name: 'scout', toolCallId: 'parent-1' });
    const files = [{ path: 'inside.ts' }, { path: '/etc/other.conf' }];

    expect(await decide('read_file', { files })).toEqual({ block: false });

    expect(mocks.requestApproval).toHaveBeenCalledTimes(1);
    expect(mocks.requestApproval).toHaveBeenCalledWith('read_file', undefined, { files }, 'scout', 'parent-1');
  });

  it('downgrades command approval when the requested cwd leaves the workspace', async () => {
    activeSettings = { ...DEFAULT_SETTINGS, autoApproveExecute: true, allowedExecuteCommands: ['npm'] };

    expect(await decide('execute_command', { command: 'npm test' })).toEqual({ block: false });
    expect(mocks.requestApproval).not.toHaveBeenCalled();

    expect(await decide('execute_command', { command: 'npm test', cwd: '/outside/project' })).toEqual({ block: false });
    expect(mocks.requestApproval).toHaveBeenCalledTimes(1);
    expect(mocks.requestApproval).toHaveBeenCalledWith(
      'execute_command',
      undefined,
      { command: 'npm test', cwd: '/outside/project' },
      undefined,
      undefined,
    );
  });

  it('hands newline-chained commands to the human even when every listed prefix is allowed', async () => {
    activeSettings = { ...DEFAULT_SETTINGS, autoApproveExecute: true, allowedExecuteCommands: ['ls'] };

    expect(await decide('execute_command', { command: 'ls\nrm -rf x' })).toEqual({ block: false });
    expect(mocks.requestApproval).toHaveBeenCalledTimes(1);
    expect(mocks.requestApproval).toHaveBeenCalledWith('execute_command', undefined, { command: 'ls\nrm -rf x' }, undefined, undefined);
  });

  it('keeps yolo from overriding an explicit deny while honoring the respect flag', async () => {
    activeSettings = { ...DEFAULT_SETTINGS, autoApproveExecute: true, yolo: true, yoloRespectDenied: true, deniedExecuteCommands: ['rm *'] };

    expect(await decide('execute_command', { command: 'rm -rf build' })).toEqual({
      block: true,
      reason: 'Execution of this command is explicitly denied by settings.',
    });

    // A confirm-worthy command sails through once denies stop being respected.
    activeSettings = { ...activeSettings, yoloRespectDenied: false };
    expect(await decide('execute_command', { command: 'npm test' })).toEqual({ block: false });
    expect(mocks.requestApproval).not.toHaveBeenCalled();
  });

  it('records confirmation durations and honors the human answer', async () => {
    mocks.requestApproval.mockResolvedValue(true);
    expect(await decide('execute_command', { command: './deploy.sh' }, { toolCallId: 'call-7' })).toEqual({ block: false });

    mocks.requestApproval.mockResolvedValue(false);
    expect(await decide('execute_command', { command: './wipe.sh' })).toEqual({ block: true, reason: 'Action denied by user.' });

    expect(mocks.recordApprovalDuration).toHaveBeenCalledTimes(1);
    expect(mocks.recordApprovalDuration).toHaveBeenCalledWith('call-7', expect.any(Number));
  });

  it('asks the human about tools the switch does not know, such as mcp', async () => {
    expect(await decide('mcp', { server: 'fs' })).toEqual({ block: false });
    expect(mocks.requestApproval).toHaveBeenCalledTimes(1);
    expect(mocks.requestApproval).toHaveBeenCalledWith('mcp', undefined, { server: 'fs' }, undefined, undefined);
  });
});

import { uuidv7 } from '@earendil-works/pi-ai';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { resolveCommandAction, resolvePathAction, resolveReadPath } from '@pi-code/extension/structures/agent-runtime/policy-action';

import type { InlineExtension, ToolCallEventResult } from '@earendil-works/pi-coding-agent';
import type { ApprovalDecision } from '@pi-code/extension/structures/agent-runtime/policy-action';
import type { ToolName } from '@pi-code/shared/core/protocol';
import type { AppSettings } from '@pi-code/shared/core/settings';

interface ReadFileToolArgs {
  readonly files?: ReadonlyArray<{ path?: string }>;
}

interface WriteFileToolArgs {
  readonly path?: string;
  readonly file_path?: string;
}

interface DeleteFileToolArgs {
  readonly path?: string;
}

interface ExecuteCommandToolArgs {
  readonly command?: string;
}

function evaluateReadFile(cwd: string, settings: AppSettings, args: unknown): ApprovalDecision {
  const toolArgs = (args ?? {}) as ReadFileToolArgs;
  const files = toolArgs.files ?? [];
  const resolutions = files.map((f) => resolveReadPath(cwd, f.path ?? '', settings));
  const action: ApprovalDecision['action'] = resolutions.includes('deny')
    ? 'deny'
    : resolutions.every((r) => r === 'approve')
      ? 'approve'
      : 'confirm';
  return toDecision(action, 'Access to read one or more specified paths is explicitly denied by settings.');
}

function evaluateWriteFile(cwd: string, settings: AppSettings, toolName: 'write_file' | 'edit_file', args: unknown): ApprovalDecision {
  const toolArgs = (args ?? {}) as WriteFileToolArgs;
  const filePath = toolName === 'write_file' ? (toolArgs.path ?? '') : (toolArgs.file_path ?? '');
  const resolution = resolvePathAction(cwd, filePath, settings.autoApproveWrite, settings.allowedWritePaths, settings.deniedWritePaths);
  return toDecision(resolution, 'Access to write/edit this file path is explicitly denied by settings.');
}

function evaluateDeleteFile(cwd: string, settings: AppSettings, args: unknown): ApprovalDecision {
  const toolArgs = (args ?? {}) as DeleteFileToolArgs;
  const filePath = toolArgs.path ?? '';
  const resolution = resolvePathAction(cwd, filePath, settings.autoApproveDelete, settings.allowedDeletePaths, settings.deniedDeletePaths);
  return toDecision(resolution, 'Access to delete this file path is explicitly denied by settings.');
}

function evaluateExecuteCommand(settings: AppSettings, args: unknown): ApprovalDecision {
  const toolArgs = (args ?? {}) as ExecuteCommandToolArgs;
  const command = toolArgs.command ?? '';
  const resolution = resolveCommandAction(command, settings.autoApproveExecute, settings.allowedExecuteCommands, settings.deniedExecuteCommands);
  return toDecision(resolution, 'Execution of this command is explicitly denied by settings.');
}

function toDecision(resolution: ApprovalDecision['action'], denyReason: string): ApprovalDecision {
  if (resolution === 'deny') {
    return { action: 'deny', reason: denyReason };
  }
  if (resolution === 'approve') {
    return { action: 'approve' };
  }
  return { action: 'confirm' };
}

interface ApprovalRequest {
  readonly id: string;
  readonly toolName: ToolName;
  readonly args: unknown;
  readonly subagent?: string;
}

const subagentBySession = new Map<string, string>();

export function registerSubagentSession(sessionId: string, name: string): void {
  subagentBySession.set(sessionId, name);
}

export function unregisterSubagentSession(sessionId: string): void {
  subagentBySession.delete(sessionId);
}

type ApprovalPresenter = (request: ApprovalRequest) => void;

export class PolicyBridge {
  private static instance: PolicyBridge | null = null;

  private readonly pending = new Map<string, (approved: boolean) => void>();
  private presenter: ApprovalPresenter | null = null;

  public static getInstance(): PolicyBridge {
    this.instance ??= new PolicyBridge();
    return this.instance;
  }

  public setPresenter(presenter: ApprovalPresenter): () => void {
    this.presenter = presenter;
    return () => {
      if (this.presenter === presenter) {
        this.presenter = null;
      }
    };
  }

  public request(toolName: ToolName, toolCallId: string | undefined, args: unknown, subagent?: string): Promise<boolean> {
    const presenter = this.presenter;
    if (!presenter) return Promise.resolve(false);

    const id = toolCallId || uuidv7();
    return new Promise<boolean>((resolve) => {
      this.pending.set(id, resolve);
      presenter({ id, toolName, args, subagent });
    });
  }

  public approve(id: string): void {
    this.settle(id, true);
  }

  public deny(id: string): void {
    this.settle(id, false);
  }

  private settle(id: string, approved: boolean): void {
    const resolve = this.pending.get(id);
    if (resolve) {
      this.pending.delete(id);
      resolve(approved);
    }
  }
}

const ALLOW: ToolCallEventResult = { block: false };

// Tools that reach the user or the model without touching the workspace. A
// sub-agent run is included because every tool it uses is policed on its own,
// so gating the delegation itself would only add a redundant prompt.
const SELF_APPROVING_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>(['attempt_completion', 'update_todo', 'ask_question', 'spawn_subagent']);

export function createToolPolicyExtension(): InlineExtension {
  return {
    name: 'pi-code-tool-policy',
    hidden: true,
    factory: (pi) => {
      pi.on('tool_call', async (event, ctx): Promise<ToolCallEventResult> => {
        const toolName = event.toolName as ToolName;
        let decision: ApprovalDecision = { action: 'confirm' };
        if (SELF_APPROVING_TOOLS.has(toolName)) {
          decision = { action: 'approve' };
        } else {
          const settings = readAppSettings();

          switch (toolName) {
            case 'read_file':
              decision = evaluateReadFile(ctx.cwd, settings, event.input);
              break;
            case 'write_file':
            case 'edit_file':
              decision = evaluateWriteFile(ctx.cwd, settings, toolName, event.input);
              break;
            case 'delete_file':
              decision = evaluateDeleteFile(ctx.cwd, settings, event.input);
              break;
            case 'execute_command':
              decision = evaluateExecuteCommand(settings, event.input);
              break;
          }
        }

        if (decision.action === 'approve') {
          return ALLOW;
        }
        if (decision.action === 'deny') {
          return { block: true, reason: decision.reason };
        }

        const subagent = subagentBySession.get(ctx.sessionManager.getSessionId());
        const approved = await PolicyBridge.getInstance().request(toolName, event.toolCallId, event.input, subagent);
        return approved ? ALLOW : { block: true, reason: 'Action denied by user.' };
      });
    },
  };
}

import { SettingsService } from '@pi-code/extension/core/settings';
import { resolveCommandAction, resolvePathAction, resolveReadPath } from '@pi-code/extension/structures/agent-runtime/policy-action';
import { logger } from '@pi-code/shared/core/logger';

import type { DecisionAction } from '@pi-code/extension/structures/agent-runtime/policy-action';
import type { ToolApprovalDecision } from '@pi-code/extension/structures/agent-runtime/runner';
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

export async function evaluateToolApproval(cwd: string, toolName: ToolName, args: unknown): Promise<ToolApprovalDecision> {
  if (toolName === 'attempt_completion' || toolName === 'update_todo' || toolName === 'ask_question') {
    return { action: 'approve' };
  }

  try {
    const settings = await SettingsService.getInstance(cwd).load();

    switch (toolName) {
      case 'read_file':
        return evaluateReadFile(cwd, settings, args);
      case 'write_file':
      case 'edit_file':
        return evaluateWriteFile(cwd, settings, toolName, args);
      case 'delete_file':
        return evaluateDeleteFile(cwd, settings, args);
      case 'execute_command':
        return evaluateExecuteCommand(settings, args);
      default:
        return { action: 'confirm' };
    }
  } catch (err) {
    logger.error('Failed to load settings for auto-approval:', err);
    return { action: 'confirm' };
  }
}

function evaluateReadFile(cwd: string, settings: AppSettings, args: unknown): ToolApprovalDecision {
  const toolArgs = (args ?? {}) as ReadFileToolArgs;
  const files = toolArgs.files ?? [];
  const resolutions = files.map((f) => resolveReadPath(cwd, f.path ?? '', settings));
  const action: DecisionAction = resolutions.includes('deny') ? 'deny' : resolutions.every((r) => r === 'approve') ? 'approve' : 'confirm';
  return toDecision(action, 'Access to read one or more specified paths is explicitly denied by settings.');
}

function evaluateWriteFile(cwd: string, settings: AppSettings, toolName: 'write_file' | 'edit_file', args: unknown): ToolApprovalDecision {
  const toolArgs = (args ?? {}) as WriteFileToolArgs;
  const filePath = toolName === 'write_file' ? (toolArgs.path ?? '') : (toolArgs.file_path ?? '');
  const resolution = resolvePathAction(cwd, filePath, settings.autoApproveWrite, settings.allowedWritePaths, settings.deniedWritePaths);
  return toDecision(resolution, 'Access to write/edit this file path is explicitly denied by settings.');
}

function evaluateDeleteFile(cwd: string, settings: AppSettings, args: unknown): ToolApprovalDecision {
  const toolArgs = (args ?? {}) as DeleteFileToolArgs;
  const filePath = toolArgs.path ?? '';
  const resolution = resolvePathAction(cwd, filePath, settings.autoApproveDelete, settings.allowedDeletePaths, settings.deniedDeletePaths);
  return toDecision(resolution, 'Access to delete this file path is explicitly denied by settings.');
}

function evaluateExecuteCommand(settings: AppSettings, args: unknown): ToolApprovalDecision {
  const toolArgs = (args ?? {}) as ExecuteCommandToolArgs;
  const command = toolArgs.command ?? '';
  const resolution = resolveCommandAction(command, settings.autoApproveExecute, settings.allowedExecuteCommands, settings.deniedExecuteCommands);
  return toDecision(resolution, 'Execution of this command is explicitly denied by settings.');
}

function toDecision(resolution: DecisionAction, denyReason: string): ToolApprovalDecision {
  if (resolution === 'deny') {
    return { action: 'deny', reason: denyReason };
  }
  if (resolution === 'approve') {
    return { action: 'approve' };
  }
  return { action: 'confirm' };
}

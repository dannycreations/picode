import { SettingsService } from '@extension/core/settings';
import { resolveCommandAction, resolvePathAction } from '@extension/utilities/action';

import type { ToolApprovalDecision } from '@extension/structures/agent-runtime/runner';
import type { ToolName } from '@extension/types/webview';

export class PolicyEvaluator {
  public async evaluate(cwd: string, toolName: ToolName, args: unknown): Promise<ToolApprovalDecision> {
    if (toolName === 'attempt_completion' || toolName === 'update_todo') {
      return { action: 'approve' };
    }

    try {
      const settings = await SettingsService.getInstance(cwd).load();

      switch (toolName) {
        case 'read_file':
          return this.evaluateReadFile(cwd, settings, args);
        case 'write_file':
        case 'edit_file':
          return this.evaluateWriteFile(cwd, settings, toolName, args);
        case 'delete_file':
          return this.evaluateDeleteFile(cwd, settings, args);
        case 'execute_command':
          return this.evaluateExecuteCommand(settings, args);
        default:
          return { action: 'confirm' };
      }
    } catch (err) {
      console.error('Failed to load settings for auto-approval:', err);
      return { action: 'confirm' };
    }
  }

  private evaluateReadFile(cwd: string, settings: any, args: any): ToolApprovalDecision {
    const files: { path: string }[] = args?.files || [];
    const allowed = (settings.allowedReadPaths || []) as string[];
    const denied = (settings.deniedReadPaths || []) as string[];

    const resolutions = files.map((f) => resolvePathAction(cwd, f.path, settings.autoApproveRead, allowed, denied));

    if (resolutions.includes('deny')) {
      return {
        action: 'deny',
        reason: 'Access to read one or more specified paths is explicitly denied by settings.',
      };
    }
    if (resolutions.every((r) => r === 'approve')) {
      return { action: 'approve' };
    }
    return { action: 'confirm' };
  }

  private evaluateWriteFile(cwd: string, settings: any, toolName: 'write_file' | 'edit_file', args: any): ToolApprovalDecision {
    const filePath = toolName === 'write_file' ? args?.path || '' : args?.file_path || '';
    const allowed = (settings.allowedWritePaths || []) as string[];
    const denied = (settings.deniedWritePaths || []) as string[];
    const resolution = resolvePathAction(cwd, filePath, settings.autoApproveWrite, allowed, denied);

    if (resolution === 'deny') {
      return {
        action: 'deny',
        reason: 'Access to write/edit this file path is explicitly denied by settings.',
      };
    }
    if (resolution === 'approve') {
      return { action: 'approve' };
    }
    return { action: 'confirm' };
  }

  private evaluateDeleteFile(cwd: string, settings: any, args: any): ToolApprovalDecision {
    const filePath = args?.path || '';
    const allowed = (settings.allowedDeletePaths || []) as string[];
    const denied = (settings.deniedDeletePaths || []) as string[];
    const resolution = resolvePathAction(cwd, filePath, settings.autoApproveDelete, allowed, denied);

    if (resolution === 'deny') {
      return {
        action: 'deny',
        reason: 'Access to delete this file path is explicitly denied by settings.',
      };
    }
    if (resolution === 'approve') {
      return { action: 'approve' };
    }
    return { action: 'confirm' };
  }

  private evaluateExecuteCommand(settings: any, args: any): ToolApprovalDecision {
    const command = args?.command || '';
    const allowed = (settings.allowedExecuteCommands || []) as string[];
    const denied = (settings.deniedExecuteCommands || []) as string[];
    const resolution = resolveCommandAction(command, settings.autoApproveExecute, allowed, denied);

    if (resolution === 'deny') {
      return {
        action: 'deny',
        reason: 'Execution of this command is explicitly denied by settings.',
      };
    }
    if (resolution === 'approve') {
      return { action: 'approve' };
    }
    return { action: 'confirm' };
  }
}

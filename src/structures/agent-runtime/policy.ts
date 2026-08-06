import { SettingsService } from '@extension/core/settings';
import { resolveCommandAction, resolvePathAction } from '@extension/utilities/action';

import type { AppSettings } from '@extension/core/settings';
import type { ToolApprovalDecision } from '@extension/structures/agent-runtime/runner';
import type { ToolName } from '@extension/types/webview';

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

export class PolicyEvaluator {
  public async evaluate(cwd: string, toolName: ToolName, args: unknown): Promise<ToolApprovalDecision> {
    if (toolName === 'attempt_completion' || toolName === 'update_todo' || toolName === 'ask_question') {
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

  private evaluateReadFile(cwd: string, settings: AppSettings, args: unknown): ToolApprovalDecision {
    const toolArgs = (args ?? {}) as ReadFileToolArgs;
    const files = toolArgs.files ?? [];

    const resolutions = files.map((f) =>
      resolvePathAction(cwd, f.path ?? '', settings.autoApproveRead, settings.allowedReadPaths, settings.deniedReadPaths),
    );

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

  private evaluateWriteFile(cwd: string, settings: AppSettings, toolName: 'write_file' | 'edit_file', args: unknown): ToolApprovalDecision {
    const toolArgs = (args ?? {}) as WriteFileToolArgs;
    const filePath = toolName === 'write_file' ? (toolArgs.path ?? '') : (toolArgs.file_path ?? '');
    const resolution = resolvePathAction(cwd, filePath, settings.autoApproveWrite, settings.allowedWritePaths, settings.deniedWritePaths);

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

  private evaluateDeleteFile(cwd: string, settings: AppSettings, args: unknown): ToolApprovalDecision {
    const toolArgs = (args ?? {}) as DeleteFileToolArgs;
    const filePath = toolArgs.path ?? '';
    const resolution = resolvePathAction(cwd, filePath, settings.autoApproveDelete, settings.allowedDeletePaths, settings.deniedDeletePaths);

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

  private evaluateExecuteCommand(settings: AppSettings, args: unknown): ToolApprovalDecision {
    const toolArgs = (args ?? {}) as ExecuteCommandToolArgs;
    const command = toolArgs.command ?? '';
    const resolution = resolveCommandAction(command, settings.autoApproveExecute, settings.allowedExecuteCommands, settings.deniedExecuteCommands);

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

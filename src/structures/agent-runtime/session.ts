import {
  AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

import { SettingsService } from '@extension/core/settings';
import { askQuestionTool } from '@extension/structures/tool-call/ask-question';
import { attemptCompletionTool } from '@extension/structures/tool-call/attempt-completion';
import { deleteFileTool } from '@extension/structures/tool-call/delete-file';
import { editFileTool } from '@extension/structures/tool-call/edit-file';
import { executeCommandTool } from '@extension/structures/tool-call/execute-command';
import { readFileTool } from '@extension/structures/tool-call/read-file';
import { updateTodoTool } from '@extension/structures/tool-call/update-todo';
import { writeFileTool } from '@extension/structures/tool-call/write-file';
import { isProjectTrusted } from '@extension/utilities/vscode';

import type { ToolName } from '@extension/types/webview';

export class SessionFactory {
  private static readonly DEFAULT_TOOLS: ToolName[] = [
    'delete_file',
    'edit_file',
    'read_file',
    'write_file',
    'execute_command',
    'ask_question',
    'attempt_completion',
    'update_todo',
  ];

  private static readonly CUSTOM_TOOLS = [
    deleteFileTool,
    editFileTool,
    readFileTool,
    writeFileTool,
    executeCommandTool,
    askQuestionTool,
    attemptCompletionTool,
    updateTodoTool,
  ];

  public static async create(cwd: string, sessionPath?: string): Promise<AgentSession> {
    const sessionManagerOption = sessionPath ? SessionManager.open(sessionPath) : undefined;
    const settings = await SettingsService.getInstance(cwd).load();
    const agentDir = getAgentDir();
    const isTrusted = isProjectTrusted(cwd);

    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: isTrusted });
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noContextFiles: !settings.enableAgentRules,
      noSkills: !settings.enableSkillDiscovery,
    });
    await resourceLoader.reload();

    const disabledTools: Set<ToolName> = new Set();
    if (!settings.enableTodoTool) disabledTools.add('update_todo');
    if (!settings.enableAskQuestionTool) disabledTools.add('ask_question');

    const { session } = await createAgentSession({
      cwd,
      sessionManager: sessionManagerOption,
      settingsManager,
      resourceLoader,
      tools: SessionFactory.DEFAULT_TOOLS.filter((tool) => !disabledTools.has(tool)),
      customTools: SessionFactory.CUSTOM_TOOLS.filter((tool) => !disabledTools.has(tool.name as ToolName)),
    });

    return session;
  }
}

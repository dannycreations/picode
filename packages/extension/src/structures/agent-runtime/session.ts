import { AgentSession, createAgentSessionFromServices, SessionManager } from '@earendil-works/pi-coding-agent';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { askQuestionTool } from '@pi-code/extension/structures/tool-call/ask-question';
import { deleteFileTool } from '@pi-code/extension/structures/tool-call/delete-file';
import { editFileTool } from '@pi-code/extension/structures/tool-call/edit-file';
import { executeCommandTool } from '@pi-code/extension/structures/tool-call/execute-command';
import { readFileTool } from '@pi-code/extension/structures/tool-call/read-file';
import { spawnSubagentTool } from '@pi-code/extension/structures/tool-call/spawn-subagent';
import { updateTodoTool } from '@pi-code/extension/structures/tool-call/update-todo';
import { writeFileTool } from '@pi-code/extension/structures/tool-call/write-file';
import { EMPTY_STATS } from '@pi-code/shared/utilities/common';

import type { ToolName } from '@pi-code/shared/core/types';

const CUSTOM_TOOLS = [
  deleteFileTool,
  editFileTool,
  readFileTool,
  writeFileTool,
  executeCommandTool,
  askQuestionTool,
  updateTodoTool,
  spawnSubagentTool,
] as const;

export async function createSession(cwd: string, sessionPath?: string): Promise<AgentSession> {
  const sessionManager = sessionPath ? SessionManager.open(sessionPath) : SessionManager.create(cwd);
  const services = await createAgentResources(cwd);
  const settings = readAppSettings();

  const disabledTools: Set<ToolName> = new Set();
  if (!settings.enableTodoTool) disabledTools.add('update_todo');
  if (!settings.enableAskQuestionTool) disabledTools.add('ask_question');
  if (!settings.enableSubagentTool) disabledTools.add('spawn_subagent');

  const enabledTools = CUSTOM_TOOLS.filter((tool) => !disabledTools.has(tool.name as ToolName));

  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    tools: enabledTools.map((tool) => tool.name as ToolName),
    customTools: enabledTools,
  });

  applyCompactionSettings(session);

  return session;
}

export function applyCompactionSettings(session: AgentSession): void {
  const settings = readAppSettings();
  const contextWindow = session.model?.contextWindow ?? EMPTY_STATS.contextLimit;
  const reserveTokens = Math.round(((100 - settings.autoCompactContextPercent) / 100) * contextWindow);
  session.settingsManager.applyOverrides({
    compaction: {
      enabled: settings.autoCompactContext,
      reserveTokens,
    },
  });
}

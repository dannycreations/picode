import { AgentSession, createAgentSessionFromServices, getAgentDir, SessionManager } from '@earendil-works/pi-coding-agent';

import { createAgentResources, lazyModelRuntime } from '@pi-code/extension/structures/agent-runtime/resource';
import { askQuestionTool } from '@pi-code/extension/structures/tool-call/ask-question';
import { attemptCompletionTool } from '@pi-code/extension/structures/tool-call/attempt-completion';
import { deleteFileTool } from '@pi-code/extension/structures/tool-call/delete-file';
import { editFileTool } from '@pi-code/extension/structures/tool-call/edit-file';
import { executeCommandTool } from '@pi-code/extension/structures/tool-call/execute-command';
import { readFileTool } from '@pi-code/extension/structures/tool-call/read-file';
import { updateTodoTool } from '@pi-code/extension/structures/tool-call/update-todo';
import { writeFileTool } from '@pi-code/extension/structures/tool-call/write-file';
import { DEFAULT_CONTEXT_LIMIT } from '@pi-code/shared/core/constants';

import type { AgentSessionServices } from '@earendil-works/pi-coding-agent';
import type { ToolName } from '@pi-code/shared/core/protocol';

const CUSTOM_TOOLS = [
  deleteFileTool,
  editFileTool,
  readFileTool,
  writeFileTool,
  executeCommandTool,
  askQuestionTool,
  attemptCompletionTool,
  updateTodoTool,
] as const;

const DEFAULT_TOOLS: ToolName[] = CUSTOM_TOOLS.map((tool) => tool.name as ToolName);

export async function createSession(cwd: string, sessionPath?: string): Promise<AgentSession> {
  const sessionManager = sessionPath ? SessionManager.open(sessionPath) : SessionManager.create(cwd);
  const { settings, settingsManager, resourceLoader } = await createAgentResources(cwd);
  const services: AgentSessionServices = {
    cwd,
    agentDir: getAgentDir(),
    modelRuntime: await lazyModelRuntime(),
    settingsManager,
    resourceLoader,
    diagnostics: [],
  };

  const disabledTools: Set<ToolName> = new Set();
  if (!settings.enableTodoTool) disabledTools.add('update_todo');
  if (!settings.enableAskQuestionTool) disabledTools.add('ask_question');

  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    tools: DEFAULT_TOOLS.filter((tool) => !disabledTools.has(tool)),
    customTools: CUSTOM_TOOLS.filter((tool) => !disabledTools.has(tool.name as ToolName)),
  });

  const contextWindow = session.model?.contextWindow ?? DEFAULT_CONTEXT_LIMIT;
  const reserveTokens = Math.round(((100 - settings.autoCompactContextPercent) / 100) * contextWindow);
  session.settingsManager.applyOverrides({
    compaction: {
      enabled: settings.autoCompactContext,
      reserveTokens,
    },
  });

  return session;
}

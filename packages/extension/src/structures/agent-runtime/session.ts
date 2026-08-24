import { AgentSession, createAgentSessionFromServices, SessionManager } from '@earendil-works/pi-coding-agent';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { loadMcpConfig, setActiveMcpConfig } from '@pi-code/extension/structures/agent-runtime/mcp/config';
import { mcpGateway } from '@pi-code/extension/structures/agent-runtime/mcp/manager';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { askQuestionTool } from '@pi-code/extension/structures/tool-call/ask-question';
import { deleteFileTool } from '@pi-code/extension/structures/tool-call/delete-file';
import { editFileTool } from '@pi-code/extension/structures/tool-call/edit-file';
import { executeCommandTool } from '@pi-code/extension/structures/tool-call/execute-command';
import { mcpTool } from '@pi-code/extension/structures/tool-call/mcp';
import { readFileTool } from '@pi-code/extension/structures/tool-call/read-file';
import { spawnSubagentTool } from '@pi-code/extension/structures/tool-call/spawn-subagent';
import { updateTodoTool } from '@pi-code/extension/structures/tool-call/update-todo';
import { writeFileTool } from '@pi-code/extension/structures/tool-call/write-file';
import { isProjectTrusted } from '@pi-code/extension/utilities/vscode';
import { resolveContextLimit } from '@pi-code/shared/utilities/common';

import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
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

  // Publishes the loaded servers for the system prompt and spawns autorun
  // servers immediately, in parallel with the rest of session setup. Failed
  // starts are logged and retried by that server's first tool call.
  const mcpReady = loadMcpConfig(cwd, { trusted: isProjectTrusted(cwd) }).then((servers) => {
    setActiveMcpConfig(servers);
    void mcpGateway.preconnect(servers, cwd);
    return servers;
  });

  const services = await createAgentResources(cwd);
  const settings = readAppSettings();

  const disabledTools: Set<ToolName> = new Set();
  if (!settings.enableTodoTool) disabledTools.add('update_todo');
  if (!settings.enableAskQuestionTool) disabledTools.add('ask_question');
  if (!settings.enableSubagentTool) disabledTools.add('spawn_subagent');

  const enabledTools: ToolDefinition[] = [...CUSTOM_TOOLS.filter((tool) => !disabledTools.has(tool.name as ToolName))];

  // The MCP gateway is inert without configuration, so the config itself
  // decides whether the proxy tool exists at all.
  const mcpServers = await mcpReady;
  if (Object.keys(mcpServers).length > 0) enabledTools.push(mcpTool);

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
  const contextWindow = resolveContextLimit(session.model?.contextWindow);
  const reserveTokens = Math.round(((100 - settings.autoCompactContextPercent) / 100) * contextWindow);
  session.settingsManager.applyOverrides({ compaction: { enabled: settings.autoCompactContext, reserveTokens } });
}

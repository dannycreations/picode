import { SessionManager } from '@earendil-works/pi-coding-agent';
import { Uri, window, workspace } from 'vscode';

import { getDefaultModelSelection } from '@pi-code/extension/core/settings';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { collectCommands } from '@pi-code/extension/structures/chat-command/command';
import { convertSessionEntries, loadSessionTranscript } from '@pi-code/extension/structures/chat-session/session';
import { DEFAULT_CONTEXT_LIMIT } from '@pi-code/shared/core/constants';
import { logger } from '@pi-code/shared/core/logger';

import type { ModelRuntime, SessionInfo } from '@earendil-works/pi-coding-agent';
import type { ChatMessage, ExtensionToWebviewMessage, HistoryItem, HistoryScope, ModelItem, StatsData } from '@pi-code/shared/core/protocol';

type SessionInitData = Extract<ExtensionToWebviewMessage, { type: 'init_data' }>['payload'];

async function listSelectableModels(modelRuntime: ModelRuntime): Promise<ModelItem[]> {
  const available = await modelRuntime.getAvailable();
  const models = available.length > 0 ? available : modelRuntime.getModels();
  return models.map((model) => ({ id: model.id, name: model.name, provider: model.provider }));
}

function resolveDefaultModelId(models: ModelItem[], preferred: { id?: string; provider?: string }): string | undefined {
  if (preferred.id && models.some((model) => model.id === preferred.id)) return preferred.id;
  if (preferred.provider) {
    const sameProvider = models.find((model) => model.provider === preferred.provider);
    if (sameProvider) return sameProvider.id;
  }
  return models[0]?.id;
}

function formatSessions(sessions: SessionInfo[]): HistoryItem[] {
  return sessions.map((session) => ({
    id: session.id,
    path: session.path,
    task: session.firstMessage || 'Untitled Task',
    ts: session.created ? new Date(session.created).getTime() : Date.now(),
  }));
}

export async function getInitData(cwd: string): Promise<SessionInitData> {
  const [sessions, resources] = await Promise.all([SessionManager.list(cwd), createAgentResources(cwd)]);

  try {
    await resources.services.modelRuntime.refresh({ allowNetwork: true });
  } catch (error) {
    logger.warn('Dynamic model refresh failed; the restored selection may fall back to another model.', error);
  }

  const [models, defaultModel] = await Promise.all([listSelectableModels(resources.services.modelRuntime), getDefaultModelSelection(cwd)]);

  return {
    models,
    history: formatSessions(sessions),
    default_model: resolveDefaultModelId(models, defaultModel),
    settings: resources.settings,
    commands: collectCommands(resources.services.resourceLoader),
  };
}

export async function loadSessionDetails(
  sessionPath: string,
  cwd: string,
): Promise<{
  messages: ChatMessage[];
  stats: StatsData;
}> {
  const sessionManager = SessionManager.open(sessionPath);
  const entries = sessionManager.buildContextEntries();

  const modelRuntime = (await createAgentResources(cwd)).services.modelRuntime;

  // Prefer the provider/model the session actually ran with; the saved id alone
  // is ambiguous when two providers share a model id. The agent settings are
  // only re-read when the session did not record a model.
  const sessionContextModel = sessionManager.buildSessionContext().model;
  const sessionModelId = sessionContextModel?.modelId ?? (await getDefaultModelSelection(cwd)).id;
  const sessionProvider = sessionContextModel?.provider;

  const model = sessionModelId
    ? sessionProvider
      ? modelRuntime.getModel(sessionProvider, sessionModelId)
      : modelRuntime.getModels().find((candidate) => candidate.id === sessionModelId)
    : undefined;

  return loadSessionTranscript(entries, model?.contextWindow ?? DEFAULT_CONTEXT_LIMIT);
}

export async function fetchHistory(cwd: string, scope: HistoryScope): Promise<HistoryItem[]> {
  const sessions = scope === 'all' ? await SessionManager.listAll() : await SessionManager.list(cwd);
  return formatSessions(sessions);
}

export async function deleteSessions(paths: string[]): Promise<void> {
  await Promise.allSettled(paths.map((path) => workspace.fs.delete(Uri.file(path), { useTrash: true })));
}

export async function exportSession(sessionPath: string, defaultId?: string): Promise<boolean> {
  let chatMessages: ChatMessage[];
  try {
    chatMessages = convertSessionEntries(SessionManager.open(sessionPath).buildContextEntries());
  } catch {
    window.showWarningMessage('The session file for this task is not available yet.');
    return false;
  }

  const uri = await window.showSaveDialog({
    defaultUri: Uri.file(`pi-code-task-${defaultId || Date.now()}.json`),
    filters: { 'JSON Files': ['json'] },
  });

  if (uri) {
    await workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(chatMessages, null, 2)));
    return true;
  }
  return false;
}

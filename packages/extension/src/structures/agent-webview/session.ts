import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { getAgentDir, SessionManager } from '@earendil-works/pi-coding-agent';
import { FileType, Uri, window, workspace } from 'vscode';

import { getDefaultModelSelection, getSettingsManager } from '@pi-code/extension/core/settings';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { collectCommands } from '@pi-code/extension/structures/chat-command/command';
import { convertSessionEntries, loadSessionTranscript } from '@pi-code/extension/structures/chat-session/session';
import { logger } from '@pi-code/shared/core/logger';
import { EMPTY_STATS } from '@pi-code/shared/utilities/common';

import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { ModelRuntime, SessionInfo } from '@earendil-works/pi-coding-agent';
import type { AgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import type { ExtensionToWebviewMessage, HistoryItem, HistoryScope, ModelItem } from '@pi-code/shared/core/protocol';
import type { ChatMessage, StatsData } from '@pi-code/shared/core/types';

type SessionInitData = Extract<ExtensionToWebviewMessage, { type: 'init_data' }>['payload'];

const CATALOG_TIMEOUT_MS = 60_000;

function resolveThinkingLevels(model: Model<Api>): ModelThinkingLevel[] {
  if (!model.reasoning) return [];

  const map = model.thinkingLevelMap;
  return map ? (Object.keys(map) as ModelThinkingLevel[]).filter((level) => map[level] !== null) : getSupportedThinkingLevels(model);
}

async function listSelectableModels(modelRuntime: ModelRuntime): Promise<ModelItem[]> {
  const available = await modelRuntime.getAvailable();
  const models = available.length > 0 ? available : modelRuntime.getModels();
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    provider: model.provider,
    supportsImages: model.input.includes('image'),
    thinkingLevels: resolveThinkingLevels(model),
  }));
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

const SESSIONS_DIR_NAME = 'sessions';
const ARCHIVES_DIR_NAME = 'archives';

export function isArchivedPath(path: string): boolean {
  return path.split(sep).includes(ARCHIVES_DIR_NAME);
}

function getCounterpartPath(path: string): { target: string; archived: boolean } {
  const segments = path.split(sep);
  const sourceIdx = segments.findIndex((segment) => segment === SESSIONS_DIR_NAME || segment === ARCHIVES_DIR_NAME);
  if (sourceIdx === -1) {
    throw new Error(`Cannot archive a session outside the ${SESSIONS_DIR_NAME} directory: ${path}`);
  }
  const currentlyArchived = segments[sourceIdx] === ARCHIVES_DIR_NAME;
  segments[sourceIdx] = currentlyArchived ? SESSIONS_DIR_NAME : ARCHIVES_DIR_NAME;
  return { target: segments.join(sep), archived: !currentlyArchived };
}

export async function listArchives(): Promise<HistoryItem[]> {
  const archivesRoot = join(getAgentDir(), ARCHIVES_DIR_NAME);
  if (!existsSync(archivesRoot)) return [];
  const entries = await workspace.fs.readDirectory(Uri.file(archivesRoot));
  const subdirs = entries
    .filter(([, type]) => type === FileType.Directory || (type & FileType.SymbolicLink) !== 0)
    .map(([name]) => join(archivesRoot, name));
  const lists = await Promise.all(subdirs.map((dir) => SessionManager.listAll(dir)));
  return lists.flatMap((sessions) => formatSessions(sessions));
}

export async function archiveSession(sourcePath: string): Promise<{ path: string; archived: boolean }> {
  const { target, archived } = getCounterpartPath(sourcePath);
  await workspace.fs.createDirectory(Uri.file(dirname(target)));
  await workspace.fs.rename(Uri.file(sourcePath), Uri.file(target), { overwrite: false });
  return { path: target, archived };
}

export async function getInitData(cwd: string, resources?: AgentResources): Promise<SessionInitData> {
  const resolved = resources ?? (await createAgentResources(cwd));
  const sessions = await SessionManager.list(cwd);

  const [models, defaultModel] = await Promise.all([listSelectableModels(resolved.services.modelRuntime), getDefaultModelSelection(cwd)]);

  const thinkingLevel = getSettingsManager(cwd).getDefaultThinkingLevel() ?? undefined;

  return {
    models,
    history: formatSessions(sessions),
    default_model: resolveDefaultModelId(models, defaultModel),
    default_thinking_level: thinkingLevel,
    settings: resolved.settings,
    commands: collectCommands(resolved.services.resourceLoader),
  };
}

export async function refreshModelCatalog(modelRuntime: ModelRuntime, onModels: (models: ModelItem[]) => void): Promise<void> {
  try {
    await modelRuntime.refresh({
      allowNetwork: true,
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    onModels(await listSelectableModels(modelRuntime));
  } catch (error) {
    logger.warn('Dynamic model refresh failed; the model list stays on the local catalog.', error);
  }
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

  return loadSessionTranscript(entries, model?.contextWindow ?? EMPTY_STATS.contextLimit);
}

export async function fetchHistory(cwd: string, scope: HistoryScope): Promise<HistoryItem[]> {
  if (scope === 'archives') return listArchives();
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

import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { contentText, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { getAgentDir, SessionManager } from '@earendil-works/pi-coding-agent';
import { FileType, Uri, window, workspace } from 'vscode';

import { getDefaultModelSelection, getSettingsManager, readAppSettings } from '@pi-code/extension/core/settings';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { collectCommands } from '@pi-code/extension/structures/chat-command/command';
import { convertSessionEntries, loadSessionTranscript } from '@pi-code/extension/structures/chat-session/session';
import { streamLines } from '@pi-code/extension/utilities/fs';
import { logger } from '@pi-code/shared/core/logger';
import { resolveContextLimit } from '@pi-code/shared/utilities/common';

import type { Api, Model, ModelThinkingLevel, TextContent } from '@earendil-works/pi-ai';
import type { AgentSessionServices, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ExtensionToWebviewMessage, HistoryItem, HistoryScope, ModelItem } from '@pi-code/shared/core/protocol';
import type { ChatMessage, StatsData } from '@pi-code/shared/core/types';

type SessionInitData = Extract<ExtensionToWebviewMessage, { type: 'init_data' }>['payload'];

const ARCHIVES_DIR_NAME = 'archives';
const SESSIONS_DIR_NAME = 'sessions';

export const SESSION_FILE_UNAVAILABLE = 'The session file for this task is not available yet.';

const MAX_PREVIEW_LINES = 2000;
const HISTORY_PREVIEW_CHUNK = 12;

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
    contextWindow: model.contextWindow,
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

function parseSessionLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readSessionPreview(filePath: string, mtime: number): Promise<HistoryItem | null> {
  try {
    let id = '';
    let created = '';
    let firstMessage = '';
    let lines = 0;
    for await (const line of streamLines(filePath)) {
      if (++lines > MAX_PREVIEW_LINES) break;
      const entry = parseSessionLine(line);
      if (!entry) continue;
      if (!id) {
        if (entry['type'] !== 'session' || typeof entry['id'] !== 'string') break;
        id = entry['id'];
        created = typeof entry['timestamp'] === 'string' ? entry['timestamp'] : '';
        continue;
      }
      if (entry['type'] === 'message' && (entry as { message?: { role?: unknown } }).message?.role === 'user') {
        const content = (entry as { message?: { content?: unknown } }).message?.content;
        firstMessage = contentText(content as string | readonly TextContent[]);
        break;
      }
    }
    if (!id) return null;
    let ts: number;
    if (mtime > 0) {
      ts = mtime;
    } else if (created) {
      ts = new Date(created).getTime();
    } else {
      ts = Date.now();
    }
    return { id, path: filePath, task: firstMessage || 'Untitled Task', ts };
  } catch {
    return null;
  }
}

async function listJsonlFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  try {
    const entries = await workspace.fs.readDirectory(Uri.file(dir));
    return entries
      .filter(([, type]) => type === FileType.File || (type & FileType.SymbolicLink) !== 0)
      .map(([name]) => join(dir, name))
      .filter((path) => path.endsWith('.jsonl'));
  } catch {
    return [];
  }
}

function getCurrentSessionDir(cwd: string): string {
  const safePath = `--${resolve(cwd)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`;
  return join(getAgentDir(), SESSIONS_DIR_NAME, safePath);
}

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

export async function archiveSession(sourcePath: string): Promise<{ path: string; archived: boolean }> {
  const { target, archived } = getCounterpartPath(sourcePath);
  await workspace.fs.createDirectory(Uri.file(dirname(target)));
  await workspace.fs.rename(Uri.file(sourcePath), Uri.file(target), { overwrite: false });
  return { path: target, archived };
}

export async function getInitData(cwd: string, services: AgentSessionServices): Promise<SessionInitData> {
  const [models, defaultModel] = await Promise.all([listSelectableModels(services.modelRuntime), getDefaultModelSelection(cwd)]);

  const thinkingLevel = getSettingsManager(cwd).getDefaultThinkingLevel() ?? undefined;

  return {
    models,
    default_model: resolveDefaultModelId(models, defaultModel),
    default_thinking_level: thinkingLevel,
    settings: readAppSettings(),
    commands: collectCommands(services.resourceLoader),
  };
}

export async function refreshModelCatalog(modelRuntime: ModelRuntime, onModels: (models: ModelItem[]) => void, force = false): Promise<void> {
  try {
    await modelRuntime.refresh({
      force,
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

  const modelRuntime = (await createAgentResources(cwd)).modelRuntime;

  // Prefer the provider/model the session actually ran with; the saved id alone
  // is ambiguous when two providers share a model id. The agent settings are
  // only re-read when the session did not record a model.
  const sessionContextModel = sessionManager.buildSessionContext().model;
  const sessionModelId = sessionContextModel?.modelId ?? (await getDefaultModelSelection(cwd)).id;
  const sessionProvider = sessionContextModel?.provider;

  let model: Model<Api> | undefined;
  if (sessionModelId && sessionProvider) {
    model = modelRuntime.getModel(sessionProvider, sessionModelId);
  } else if (sessionModelId) {
    model = modelRuntime.getModels().find((candidate) => candidate.id === sessionModelId);
  }

  return loadSessionTranscript(entries, resolveContextLimit(model?.contextWindow));
}

export async function* streamHistory(cwd: string, scope: HistoryScope): AsyncGenerator<HistoryItem[]> {
  const files: string[] = [];
  if (scope === 'current') {
    files.push(...(await listJsonlFiles(getCurrentSessionDir(cwd))));
  } else {
    const root = scope === 'archives' ? join(getAgentDir(), ARCHIVES_DIR_NAME) : join(getAgentDir(), SESSIONS_DIR_NAME);
    if (!existsSync(root)) return;
    const entries = await workspace.fs.readDirectory(Uri.file(root));
    for (const [name, type] of entries) {
      if (type === FileType.Directory || (type & FileType.SymbolicLink) !== 0) {
        files.push(...(await listJsonlFiles(join(root, name))));
      }
    }
  }

  // One cheap stat per file so we can stream newest-first without reading full
  // contents up front.
  const metas = (
    await Promise.all(
      files.map(async (path) => {
        try {
          const stat = await workspace.fs.stat(Uri.file(path));
          return { path, mtime: typeof stat.mtime === 'number' ? stat.mtime : 0 };
        } catch {
          return null;
        }
      }),
    )
  ).filter((meta): meta is { path: string; mtime: number } => meta !== null);
  metas.sort((a, b) => b.mtime - a.mtime);

  let chunk: HistoryItem[] = [];
  for (const meta of metas) {
    const preview = await readSessionPreview(meta.path, meta.mtime);
    if (!preview) continue;
    chunk.push(preview);
    if (chunk.length >= HISTORY_PREVIEW_CHUNK) {
      yield chunk;
      chunk = [];
    }
  }
  if (chunk.length > 0) yield chunk;
}

export async function deleteSessions(paths: string[]): Promise<void> {
  await Promise.allSettled(paths.map((path) => workspace.fs.delete(Uri.file(path), { useTrash: true })));
}

export async function exportSession(sessionPath: string, defaultId?: string): Promise<boolean> {
  let chatMessages: ChatMessage[];
  try {
    chatMessages = convertSessionEntries(SessionManager.open(sessionPath).buildContextEntries());
  } catch {
    window.showWarningMessage(SESSION_FILE_UNAVAILABLE);
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

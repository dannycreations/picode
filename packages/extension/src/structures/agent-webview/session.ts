import { unlink } from 'node:fs/promises';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { Uri, window, workspace } from 'vscode';

import { SettingsService } from '@pi-code/extension/core/settings';
import { listCommands } from '@pi-code/extension/structures/chat-command/command';
import { calculateSessionStats, convertSessionEntries } from '@pi-code/extension/structures/chat-session/session';
import { DEFAULT_CONTEXT_LIMIT } from '@pi-code/shared/core/constants';
import { logger } from '@pi-code/shared/core/logger';

import type { SessionInfo } from '@earendil-works/pi-coding-agent';
import type { SessionTreeEntry } from '@pi-code/extension/types/extension';
import type { ChatMessage, CommandItem, ExtensionToWebviewMessage, HistoryItem, StatsData } from '@pi-code/shared/core/protocol';

export type SessionInitData = Extract<ExtensionToWebviewMessage, { type: 'init_data' }>['payload'];

export class SessionService {
  private modelRuntimePromise: Promise<ModelRuntime> | null = null;

  private getModelRuntime(): Promise<ModelRuntime> {
    this.modelRuntimePromise ??= ModelRuntime.create();
    return this.modelRuntimePromise;
  }

  public async getInitData(cwd: string): Promise<SessionInitData> {
    const settingsService = SettingsService.getInstance(cwd);
    const [modelRuntime, sessions, settings, commands] = await Promise.all([
      this.getModelRuntime(),
      SessionManager.list(cwd),
      settingsService.load(),
      this.fetchCommands(cwd),
    ]);
    const models = modelRuntime.getModels().map((m) => ({ id: m.id, name: m.name, provider: m.provider }));

    const history = this.formatSessions(sessions);
    const defaultModel = await settingsService.getDefaultModel();

    return { models, history, default_model: defaultModel, settings, commands };
  }

  public async fetchCommands(cwd: string): Promise<CommandItem[]> {
    try {
      return await listCommands(cwd);
    } catch (err) {
      logger.error('Failed to list commands:', err);
      return [];
    }
  }

  public async loadSessionDetails(
    sessionPath: string,
    cwd: string,
  ): Promise<{
    messages: ChatMessage[];
    stats: StatsData;
  }> {
    const sessionManager = SessionManager.open(sessionPath);
    const entries = sessionManager.getEntries();
    const chatMessages = convertSessionEntries(entries as SessionTreeEntry[]);

    const modelRuntime = await this.getModelRuntime();
    const models = modelRuntime.getModels();

    let sessionModelId = await SettingsService.getInstance(cwd).getDefaultModel();
    for (const entry of entries) {
      if (entry.type === 'model_change') {
        sessionModelId = entry.modelId || sessionModelId;
      }
    }

    let contextLimit: number = DEFAULT_CONTEXT_LIMIT;
    if (sessionModelId) {
      const matchedModel = models.find((m) => m.id === sessionModelId);
      if (matchedModel?.contextWindow) {
        contextLimit = matchedModel.contextWindow;
      }
    }

    const stats = calculateSessionStats(entries as SessionTreeEntry[], contextLimit);
    return { messages: chatMessages, stats };
  }

  public async fetchHistory(cwd: string, scope: 'all' | 'current'): Promise<HistoryItem[]> {
    const sessions = scope === 'all' ? await SessionManager.listAll() : await SessionManager.list(cwd);
    return this.formatSessions(sessions);
  }

  public async deleteSessions(paths: string[]): Promise<void> {
    await Promise.allSettled(paths.map((p) => unlink(p)));
  }

  public async exportSession(sessionPath: string, defaultId?: string): Promise<boolean> {
    const sessionManager = SessionManager.open(sessionPath);
    const entries = sessionManager.getEntries() as SessionTreeEntry[];
    const chatMessages = convertSessionEntries(entries);
    const jsonString = JSON.stringify(chatMessages, null, 2);

    const uri = await window.showSaveDialog({
      defaultUri: Uri.file(`pi-code-task-${defaultId || Date.now()}.json`),
      filters: { 'JSON Files': ['json'] },
    });

    if (uri) {
      await workspace.fs.writeFile(uri, Buffer.from(jsonString, 'utf8'));
      return true;
    }
    return false;
  }

  private formatSessions(sessions: SessionInfo[]): HistoryItem[] {
    return sessions.map((s) => ({
      id: s.id,
      path: s.path,
      task: s.firstMessage || 'Untitled Task',
      ts: s.created ? new Date(s.created).getTime() : Date.now(),
    }));
  }
}

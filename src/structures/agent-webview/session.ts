import { unlink } from 'node:fs/promises';
import { getAgentDir, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { Uri, window, workspace } from 'vscode';

import { calculateSessionStats, convertSessionEntries } from '@extension/structures/chat-session/session';
import { isProjectTrusted } from '@extension/utilities/vscode';

import type { SessionInfo } from '@earendil-works/pi-coding-agent';
import type { CalculatedStats } from '@extension/structures/chat-session/session';
import type { SessionTreeEntry } from '@extension/types/extension';
import type { ChatMessage, ExtensionToWebviewMessage, HistoryItem } from '@extension/types/webview';

export type SessionInitData = Extract<ExtensionToWebviewMessage, { type: 'init_data' }>['payload'];

export class SessionService {
  public async getInitData(cwd: string): Promise<SessionInitData> {
    const agentDir = getAgentDir();
    const isTrusted = isProjectTrusted(cwd);

    const [modelRuntime, sessions] = await Promise.all([ModelRuntime.create(), SessionManager.list(cwd)]);
    const models = modelRuntime.getModels().map((m) => ({ id: m.id, name: m.name, provider: m.provider }));

    const history = this.formatSessions(sessions);
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: isTrusted });
    const defaultModel = settingsManager.getDefaultModel();

    return { models, history, default_model: defaultModel };
  }

  public async loadSessionDetails(
    sessionPath: string,
    cwd: string,
  ): Promise<{
    messages: ChatMessage[];
    stats: CalculatedStats;
  }> {
    const sessionManager = SessionManager.open(sessionPath);
    const entries = sessionManager.getEntries();
    const chatMessages = convertSessionEntries(entries as SessionTreeEntry[]);

    const modelRuntime = await ModelRuntime.create();
    const models = modelRuntime.getModels();
    const agentDir = getAgentDir();
    const isTrusted = isProjectTrusted(cwd);
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: isTrusted });

    let sessionModelId = settingsManager.getDefaultModel();
    for (const entry of entries) {
      if (entry.type === 'model_change') {
        sessionModelId = entry.modelId || sessionModelId;
      }
    }

    let contextLimit = 200000;
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

  public async deleteSessions(paths: string[], scope: 'all' | 'current', cwd: string): Promise<HistoryItem[]> {
    await Promise.allSettled(paths.map((p) => unlink(p)));
    return this.fetchHistory(cwd, scope);
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

import { unlink } from 'node:fs/promises';
import { getAgentDir, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import { Uri, window, workspace } from 'vscode';

import { calculateSessionStats, convertSessionEntries } from '@extension/structures/chat-session/session';
import { AgentModel, SessionTreeEntry } from '@extension/types/extension';
import { ExtensionToWebviewMessage } from '@extension/types/webview';
import { isProjectTrusted } from '@extension/utilities/vscode';

export type SessionInitData = Extract<ExtensionToWebviewMessage, { type: 'init_data' }>['payload'];

export class SessionService {
  public async getInitData(cwd: string): Promise<SessionInitData> {
    const agentDir = getAgentDir();
    const isTrusted = isProjectTrusted(cwd);

    const [modelRuntime, sessions] = await Promise.all([ModelRuntime.create(), SessionManager.list(cwd)]);

    const models = modelRuntime.getModels().map((m: AgentModel) => ({
      id: m.id,
      name: m.displayName || m.id,
    }));

    const history = this.formatSessions(sessions);
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: isTrusted });
    const defaultModel = settingsManager.getDefaultModel();

    return { models, history, default_model: defaultModel };
  }

  public async loadSessionDetails(sessionPath: string, cwd: string) {
    const sessionManager = SessionManager.open(sessionPath);
    const entries = sessionManager.getEntries() as SessionTreeEntry[];
    const chatMessages = convertSessionEntries(entries);

    const modelRuntime = await ModelRuntime.create();
    const models = modelRuntime.getModels();
    const agentDir = getAgentDir();
    const isTrusted = isProjectTrusted(cwd);
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: isTrusted });

    let sessionModelId = settingsManager.getDefaultModel();
    for (const entry of entries) {
      if ((entry as any).type === 'model_change') {
        sessionModelId = (entry as any).modelId || sessionModelId;
      }
    }

    let contextLimit = 200000;
    if (sessionModelId) {
      const matchedModel = models.find((m) => m.id === sessionModelId);
      if (matchedModel?.contextWindow) {
        contextLimit = matchedModel.contextWindow;
      }
    }

    const stats = calculateSessionStats(entries, contextLimit);
    return { messages: chatMessages, stats };
  }

  public async fetchHistory(cwd: string, scope: 'all' | 'current') {
    const sessions = scope === 'all' ? await SessionManager.listAll() : await SessionManager.list(cwd);
    return this.formatSessions(sessions);
  }

  public async deleteSessions(paths: string[], scope: 'all' | 'current', cwd: string) {
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

  private formatSessions(sessions: Awaited<ReturnType<typeof SessionManager.list>>) {
    return sessions.map((s) => ({
      id: s.id,
      path: s.path,
      task: s.firstMessage || 'Untitled Task',
      ts: s.created ? new Date(s.created).getTime() : Date.now(),
    }));
  }
}

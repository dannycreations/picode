import { SessionManager } from '@earendil-works/pi-coding-agent';
import { Uri, window, workspace } from 'vscode';

import { SettingsService } from '@pi-code/extension/core/settings';
import { createAgentResources, lazyModelRuntime } from '@pi-code/extension/structures/agent-runtime/resource';
import { collectCommands } from '@pi-code/extension/structures/chat-command/command';
import { calculateSessionStats, convertSessionEntries } from '@pi-code/extension/structures/chat-session/session';
import { DEFAULT_CONTEXT_LIMIT } from '@pi-code/shared/core/constants';

import type { SessionInfo } from '@earendil-works/pi-coding-agent';
import type { ChatMessage, ExtensionToWebviewMessage, HistoryItem, HistoryScope, StatsData } from '@pi-code/shared/core/protocol';

type SessionInitData = Extract<ExtensionToWebviewMessage, { type: 'init_data' }>['payload'];

export class SessionService {
  public async getInitData(cwd: string): Promise<SessionInitData> {
    const [modelRuntime, sessions, resources] = await Promise.all([lazyModelRuntime(), SessionManager.list(cwd), createAgentResources(cwd)]);
    const models = modelRuntime.getModels().map((m) => ({ id: m.id, name: m.name, provider: m.provider }));

    const history = this.formatSessions(sessions);
    const defaultModel = await SettingsService.getInstance(cwd).getDefaultModel();

    return {
      models,
      history,
      default_model: defaultModel,
      settings: resources.settings,
      commands: collectCommands(resources.resourceLoader),
    };
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
    const chatMessages = convertSessionEntries(entries);

    const modelRuntime = await lazyModelRuntime();
    const models = modelRuntime.getModels();

    const sessionContextModel = sessionManager.buildSessionContext().model;
    const sessionModelId = sessionContextModel?.modelId ?? (await SettingsService.getInstance(cwd).getDefaultModel());

    let contextLimit: number = DEFAULT_CONTEXT_LIMIT;
    if (sessionModelId) {
      const matchedModel = models.find((m) => m.id === sessionModelId);
      if (matchedModel?.contextWindow) {
        contextLimit = matchedModel.contextWindow;
      }
    }

    const stats = calculateSessionStats(entries, contextLimit);
    return { messages: chatMessages, stats };
  }

  public async fetchHistory(cwd: string, scope: HistoryScope): Promise<HistoryItem[]> {
    const sessions = scope === 'all' ? await SessionManager.listAll() : await SessionManager.list(cwd);
    return this.formatSessions(sessions);
  }

  public async deleteSessions(paths: string[]): Promise<void> {
    await Promise.allSettled(paths.map((p) => workspace.fs.delete(Uri.file(p), { useTrash: false })));
  }

  public async exportSession(sessionPath: string, defaultId?: string): Promise<boolean> {
    const sessionManager = SessionManager.open(sessionPath);
    const chatMessages = convertSessionEntries(sessionManager.getEntries());

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

  private formatSessions(sessions: SessionInfo[]): HistoryItem[] {
    return sessions.map((s) => ({
      id: s.id,
      path: s.path,
      task: s.firstMessage || 'Untitled Task',
      ts: s.created ? new Date(s.created).getTime() : Date.now(),
    }));
  }
}

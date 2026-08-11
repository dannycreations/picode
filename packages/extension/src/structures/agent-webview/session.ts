import { SessionManager } from '@earendil-works/pi-coding-agent';
import { Uri, window, workspace } from 'vscode';

import { getDefaultModel } from '@pi-code/extension/core/settings';
import { createAgentResources, getModelRuntime } from '@pi-code/extension/structures/agent-runtime/resource';
import { collectCommands } from '@pi-code/extension/structures/chat-command/command';
import { calculateSessionStats, convertSessionEntries } from '@pi-code/extension/structures/chat-session/session';
import { DEFAULT_CONTEXT_LIMIT } from '@pi-code/shared/core/constants';

import type { ModelRuntime, SessionInfo } from '@earendil-works/pi-coding-agent';
import type { ChatMessage, ExtensionToWebviewMessage, HistoryItem, HistoryScope, ModelItem, StatsData } from '@pi-code/shared/core/protocol';

type SessionInitData = Extract<ExtensionToWebviewMessage, { type: 'init_data' }>['payload'];

async function listSelectableModels(modelRuntime: ModelRuntime): Promise<ModelItem[]> {
  const available = await modelRuntime.getAvailable();
  const models = available.length > 0 ? available : modelRuntime.getModels();
  return models.map((model) => ({ id: model.id, name: model.name, provider: model.provider }));
}

export class SessionService {
  public async getInitData(cwd: string): Promise<SessionInitData> {
    const [sessions, resources] = await Promise.all([SessionManager.list(cwd), createAgentResources(cwd)]);
    const models = await listSelectableModels(resources.services.modelRuntime);

    const history = this.formatSessions(sessions);
    const defaultModel = await getDefaultModel(cwd);

    return {
      models,
      history,
      default_model: defaultModel,
      settings: resources.settings,
      commands: collectCommands(resources.services.resourceLoader),
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
    const entries = sessionManager.buildContextEntries();
    const chatMessages = convertSessionEntries(entries);

    const modelRuntime = await getModelRuntime(cwd);

    const sessionContextModel = sessionManager.buildSessionContext().model;
    const fallbackModelId = await getDefaultModel(cwd);

    // Prefer the provider/model the session actually ran with; the saved id alone
    // is ambiguous when two providers share a model id.
    const sessionModelId = sessionContextModel?.modelId ?? fallbackModelId;
    const sessionProvider = sessionContextModel?.provider;

    const model = sessionModelId
      ? sessionProvider
        ? modelRuntime.getModel(sessionProvider, sessionModelId)
        : modelRuntime.getModels().find((candidate) => candidate.id === sessionModelId)
      : undefined;

    const stats = calculateSessionStats(entries, model?.contextWindow ?? DEFAULT_CONTEXT_LIMIT);
    return { messages: chatMessages, stats };
  }

  public async fetchHistory(cwd: string, scope: HistoryScope): Promise<HistoryItem[]> {
    const sessions = scope === 'all' ? await SessionManager.listAll() : await SessionManager.list(cwd);
    return this.formatSessions(sessions);
  }

  public async deleteSessions(paths: string[]): Promise<void> {
    await Promise.allSettled(paths.map((p) => workspace.fs.delete(Uri.file(p), { useTrash: true })));
  }

  public async exportSession(sessionPath: string, defaultId?: string): Promise<boolean> {
    let chatMessages: ChatMessage[];
    try {
      const sessionManager = SessionManager.open(sessionPath);
      chatMessages = convertSessionEntries(sessionManager.buildContextEntries());
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

  private formatSessions(sessions: SessionInfo[]): HistoryItem[] {
    return sessions.map((s) => ({
      id: s.id,
      path: s.path,
      task: s.firstMessage || 'Untitled Task',
      ts: s.created ? new Date(s.created).getTime() : Date.now(),
    }));
  }
}

import { uuidv7 } from '@earendil-works/pi-ai';
import { window } from 'vscode';

import { getSettingsManager, readAppSettings } from '@pi-code/extension/core/settings';
import { cancelAllApprovals } from '@pi-code/extension/structures/agent-runtime/brokers/approval';
import { cancelAllQuestions } from '@pi-code/extension/structures/agent-runtime/brokers/question';
import { mapEvent } from '@pi-code/extension/structures/agent-runtime/event';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { createSession } from '@pi-code/extension/structures/agent-runtime/session';
import { WebviewMessenger } from '@pi-code/extension/structures/agent-runtime/webview';
import { collectCommands } from '@pi-code/extension/structures/chat-command/command';
import { getEnvironmentDetails, getLatestTodoList, withTodoProgress } from '@pi-code/extension/structures/chat-session/environment';
import { loadSessionTranscript } from '@pi-code/extension/structures/chat-session/session';
import { parseBase64DataUrl } from '@pi-code/extension/utilities/codec';
import { getWorkspaceCwd } from '@pi-code/extension/utilities/vscode';
import { logger } from '@pi-code/shared/core/logger';
import { EMPTY_STATS } from '@pi-code/shared/utilities/common';

import type { ImageContent, ModelThinkingLevel, TextContent } from '@earendil-works/pi-ai';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';
import type { ExtensionToWebviewMessage, ModelSelection, QueueMessage } from '@pi-code/shared/core/protocol';
import type { ChatMessage, StatsData } from '@pi-code/shared/core/types';

function parseImageAttachments(images?: string[]): ImageContent[] | undefined {
  if (!images || images.length === 0) return undefined;

  return images
    .map((img) => {
      const parts = parseBase64DataUrl(img);
      return parts ? { type: 'image' as const, mimeType: parts.mimeType, data: parts.data } : null;
    })
    .filter((item): item is ImageContent => item !== null);
}

export class AgentRunner {
  private session: AgentSession | null = null;
  private unsubscribeSessionEvents: (() => void) | null = null;
  private replyQueue: QueueMessage[] = [];
  private cancelRequested = false;
  private pendingThinkingLevel?: ModelThinkingLevel;
  private apiRequestId: string | null = null;
  private compacting = false;

  private readonly messenger = new WebviewMessenger();

  public constructor(webview: Webview) {
    this.messenger.attach(webview);
  }

  public postMessage(message: ExtensionToWebviewMessage): void {
    this.messenger.post(message);
  }

  public addToReplyQueue(text: string, images?: string[]): void {
    const msg: QueueMessage = {
      id: uuidv7(),
      text,
      images,
      ts: Date.now(),
    };
    this.replyQueue.push(msg);
    this.broadcastReplyQueue();
  }

  public editReplyQueue(id: string, text: string): void {
    this.replyQueue = this.replyQueue.map((m) => (m.id === id ? { ...m, text } : m));
    this.broadcastReplyQueue();
  }

  public removeFromReplyQueue(id: string): void {
    this.replyQueue = this.replyQueue.filter((m) => m.id !== id);
    this.broadcastReplyQueue();
  }

  public clearReplyQueue(): void {
    this.replyQueue = [];
    this.broadcastReplyQueue();
  }

  public broadcastReplyQueue(): void {
    this.messenger.post({
      type: 'reply_queue_data',
      payload: { queue: this.replyQueue },
    });
  }

  public async startTask(promptText: string, selectedModel: ModelSelection | undefined, images?: string[], path?: string): Promise<void> {
    this.clearReplyQueue();

    try {
      const { session, envDetails } = await this.prepareSession(path, selectedModel);

      // `nextTurn` makes pi attach the details to the upcoming user message, so
      // they reach the model and get persisted with the turn that used them.
      await session.sendCustomMessage({ customType: 'environment_details', content: envDetails, display: false }, { deliverAs: 'nextTurn' });

      const attachments = parseImageAttachments(images);

      void session.prompt(promptText, { images: attachments }).catch((err) => {
        if (this.cancelRequested) {
          this.messenger.post({ type: 'info', payload: { text: 'Task cancelled.' } });
          return;
        }
        this.messenger.postError(err);
      });
    } catch (err) {
      this.messenger.postError(err);
    }
  }

  public async continueTask(path: string, selectedModel?: ModelSelection): Promise<void> {
    try {
      const { session, envDetails } = await this.prepareSession(path, selectedModel);

      void session
        .sendCustomMessage({ customType: 'environment_details', content: envDetails, display: false }, { triggerTurn: true })
        .catch((err) => {
          if (this.cancelRequested) {
            this.messenger.post({ type: 'info', payload: { text: 'Task cancelled.' } });
            return;
          }
          this.messenger.postError(err);
        });
    } catch (err) {
      this.messenger.postError(err);
    }
  }

  public async compact(path: string | undefined): Promise<{ messages: ChatMessage[]; stats: StatsData } | null> {
    this.prepareRun();
    const cwd = getWorkspaceCwd();

    this.compacting = true;
    try {
      const session = await this.getOrCreateSession(path, cwd);
      await session.compact();

      // Returns the compacted transcript and its stats so the caller can refresh the
      // webview from the in-memory session instead of re-opening the file on disk.
      const entries = session.sessionManager.buildContextEntries();
      return loadSessionTranscript(entries, session.model?.contextWindow ?? EMPTY_STATS.contextLimit);
    } catch (err) {
      this.messenger.postError(err);
      return null;
    } finally {
      this.compacting = false;
    }
  }

  public async reload(): Promise<void> {
    if (this.session?.isStreaming || this.session?.isCompacting) {
      window.showInformationMessage('Wait for the current task to finish before reloading.');
      return;
    }

    window.showInformationMessage('Reloading skills, context files, and configuration...');

    try {
      await this.session?.reload();
      window.showInformationMessage('Reloaded skills, context files, and configuration.');

      const { services } = await createAgentResources(getWorkspaceCwd());
      const commands = collectCommands(services.resourceLoader);
      this.messenger.post({ type: 'commands_data', payload: { commands } });
    } catch (err) {
      this.messenger.postError(err);
    }
  }

  public setThinkingLevel(level: ModelThinkingLevel): void {
    this.pendingThinkingLevel = level;
    try {
      getSettingsManager(getWorkspaceCwd()).setDefaultThinkingLevel(level);
    } catch (err) {
      logger.warn(`Could not persist thinking level ${level}:`, err);
    }
    if (this.session) {
      try {
        this.session.setThinkingLevel(level);
      } catch (err) {
        logger.warn(`Could not apply thinking level ${level}:`, err);
      }
    }
  }

  public reset(): void {
    this.cleanupSession();
    this.cleanupPending();
    this.clearReplyQueue();
  }

  public cancelTask(): void {
    this.cancelRequested = true;
    this.cleanupPending();
    this.clearReplyQueue();
    void this.session?.abort().catch((err) => logger.warn('Failed to abort session on cancel:', err));
  }

  public dispose(): void {
    this.messenger.dispose();
    this.cleanupSession();
    this.cleanupPending();
    this.clearReplyQueue();
  }

  private cleanupPending(): void {
    cancelAllQuestions();
    cancelAllApprovals();
  }

  private prepareRun(): void {
    this.cleanupPending();
    this.cancelRequested = false;
    this.apiRequestId = null;
  }

  public getSessionFile(): string | undefined {
    return this.session?.sessionFile;
  }

  private async prepareSession(
    path: string | undefined,
    selectedModel: ModelSelection | undefined,
  ): Promise<{ session: AgentSession; envDetails: string }> {
    this.prepareRun();
    const cwd = getWorkspaceCwd();

    const session = await this.getOrCreateSession(path, cwd);

    // Apply and persist the model chosen in the footer before prompting.
    await this.applySelectedModel(session, selectedModel);

    if (this.pendingThinkingLevel) {
      try {
        session.setThinkingLevel(this.pendingThinkingLevel);
      } catch (err) {
        logger.warn(`Could not apply thinking level ${this.pendingThinkingLevel}:`, err);
      }
    }

    const isNewSession = session.agent.state.messages.length === 0;
    const envDetails = await getEnvironmentDetails(cwd, isNewSession);
    return { session, envDetails };
  }

  private async getOrCreateSession(path: string | undefined, cwd: string): Promise<AgentSession> {
    if (this.session && (!path || this.session.sessionFile === path)) {
      return this.session;
    }

    this.cleanupSession();

    const session = await createSession(cwd, path);
    this.session = session;

    this.setupSessionHook(session);
    this.subscribeToSessionEvents(session);

    return session;
  }

  private async applySelectedModel(session: AgentSession, selectedModel: ModelSelection | undefined): Promise<void> {
    if (!selectedModel || !selectedModel.id || !selectedModel.provider) return;

    const model = session.modelRuntime.getModel(selectedModel.provider, selectedModel.id);
    if (!model) return;

    try {
      await session.setModel(model);
    } catch (err) {
      logger.warn(`Could not apply selected model ${selectedModel.provider}/${selectedModel.id}:`, err);
    }
  }

  private setupSessionHook(session: AgentSession): void {
    const baseShouldStop = session.agent.shouldStopAfterTurn;
    session.agent.shouldStopAfterTurn = (context): boolean | Promise<boolean> => {
      if (this.cancelRequested) return true;
      return baseShouldStop?.(context) ?? false;
    };

    const basePrepareContext = session.agent.prepareNextTurnWithContext;
    session.agent.prepareNextTurnWithContext = async (context, signal) => {
      const snapshot = await basePrepareContext?.(context, signal);

      if (this.replyQueue.length > 0) {
        const undelivered: QueueMessage[] = [];
        const delivered: ChatMessage[] = [];

        for (const msg of this.replyQueue) {
          const attachments = parseImageAttachments(msg.images);
          const content: (TextContent | ImageContent)[] = [{ type: 'text', text: msg.text }];
          if (attachments) {
            content.push(...attachments);
          }

          try {
            session.agent.steer({ role: 'user', content, timestamp: msg.ts });
            delivered.push({ id: msg.id, sender: 'user', text: msg.text, images: msg.images, ts: msg.ts });
          } catch (err) {
            logger.error('Failed to steer queued reply, keeping it for later:', err);
            undelivered.push(msg);
          }
        }

        // Surface the consumed replies as user messages so they render live
        if (delivered.length > 0) {
          this.messenger.post({ type: 'reply_queue_delivered', payload: { messages: delivered } });
        }

        // Only drop the messages that were actually delivered; failed ones
        // stay queued and are retried on the next turn.
        this.replyQueue = undelivered;
        this.broadcastReplyQueue();
      }

      // Keep the agent aware of the current todo list every turn without
      // polluting session history: inject a small, current-state reminder as a
      // transient message (stripped before the next turn) into this request's
      // context only. It is never persisted, so history stays clean.
      const baseContext = snapshot?.context ?? context.context;
      if (baseContext?.messages) {
        const settings = readAppSettings();
        const todoList = settings.enableTodoTool ? getLatestTodoList(context.context.messages) : undefined;
        const messages = withTodoProgress(baseContext.messages, todoList);
        return { ...(snapshot ?? {}), context: { ...baseContext, messages } };
      }

      return snapshot;
    };
  }

  private subscribeToSessionEvents(session: AgentSession): void {
    this.unsubscribeSessionEvents = session.subscribe((event) => {
      this.handleSessionEvent(event, session);
    });
  }

  private handleSessionEvent(event: AgentSessionEvent, session: AgentSession): void {
    if (event.type === 'agent_settled' || event.type === 'agent_end') {
      this.clearReplyQueue();
    }

    if (this.compacting && (event.type === 'compaction_start' || event.type === 'compaction_end')) {
      return;
    }

    const { message, apiRequestId } = mapEvent(event, session, this.apiRequestId);
    this.apiRequestId = apiRequestId;

    if (message) {
      this.messenger.post(message);
    }
  }

  private cleanupSession(): void {
    if (this.unsubscribeSessionEvents) {
      try {
        this.unsubscribeSessionEvents();
      } catch (err) {
        logger.error('Failed to unsubscribe session events during cleanup:', err);
      }
      this.unsubscribeSessionEvents = null;
    }

    if (this.session) {
      try {
        this.session.dispose();
      } catch (err) {
        logger.error('Failed to dispose session during cleanup:', err);
      }
      this.session = null;
    }
  }
}

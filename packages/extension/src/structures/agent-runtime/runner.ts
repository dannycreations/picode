import { randomUUID } from 'crypto';

import { EventMapper } from '@pi-code/extension/structures/agent-runtime/event';
import { QuestionBridge } from '@pi-code/extension/structures/agent-runtime/question';
import { createSession } from '@pi-code/extension/structures/agent-runtime/session';
import { WebviewMessenger } from '@pi-code/extension/structures/agent-runtime/webview';
import { listCommands } from '@pi-code/extension/structures/chat-command/command';
import { getEnvironmentDetails } from '@pi-code/extension/structures/chat-session/environment';
import { parseBase64DataUrl } from '@pi-code/extension/utilities/codec';
import { getWorkspaceCwd } from '@pi-code/extension/utilities/vscode';
import { logger } from '@pi-code/shared/core/logger';

import type { AfterToolCallResult } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';
import type { ModelItem, QueueMessage } from '@pi-code/shared/core/protocol';

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

  private readonly messenger = new WebviewMessenger();
  private readonly event = new EventMapper();
  private readonly question = QuestionBridge.getInstance();

  public addToReplyQueue(text: string, images?: string[]): void {
    const msg: QueueMessage = {
      id: randomUUID(),
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

  public async startTask(
    promptText: string,
    selectedModel: Pick<ModelItem, 'id' | 'provider'> | undefined,
    webview: Webview,
    images?: string[],
    path?: string,
  ): Promise<void> {
    this.clearReplyQueue();

    try {
      const { session, envDetails } = await this.prepareSession(webview, path, selectedModel);

      // `nextTurn` makes pi attach the details to the upcoming user message, so
      // they reach the model and get persisted with the turn that used them.
      await session.sendCustomMessage({ customType: 'environment_details', content: envDetails, display: false }, { deliverAs: 'nextTurn' });

      const attachments = parseImageAttachments(images);

      void session.prompt(promptText, { images: attachments }).catch((err) => {
        this.messenger.postError(err);
      });
    } catch (err) {
      this.messenger.postError(err);
    }
  }

  public async continueTask(path: string, webview: Webview, selectedModel?: Pick<ModelItem, 'id' | 'provider'>): Promise<void> {
    try {
      const { session, envDetails } = await this.prepareSession(webview, path, selectedModel);

      void session
        .sendCustomMessage({ customType: 'environment_details', content: envDetails, display: false }, { triggerTurn: true })
        .catch((err) => {
          this.messenger.postError(err);
        });
    } catch (err) {
      this.messenger.postError(err);
    }
  }

  public answerQuestion(questionId: string, text: string): void {
    this.question.answer(questionId, text);
  }

  public async compact(path: string | undefined, webview: Webview): Promise<void> {
    this.prepareRun(webview);
    const cwd = getWorkspaceCwd();

    const session = await this.getOrCreateSession(path, cwd);

    try {
      await session.compact();
    } catch (err) {
      this.messenger.postError(err);
    }
  }

  public async reload(webview: Webview): Promise<void> {
    this.messenger.attach(webview);

    if (this.session?.isStreaming || this.session?.isCompacting) {
      this.messenger.post({ type: 'info', payload: { text: 'Wait for the current task to finish before reloading.' } });
      return;
    }

    this.messenger.post({ type: 'info', payload: { text: 'Reloading skills, context files, and configuration…' } });

    try {
      await this.session?.reload();
      this.messenger.post({ type: 'info', payload: { text: 'Reloaded skills, context files, and configuration.' } });

      const commands = await listCommands(getWorkspaceCwd());
      this.messenger.post({ type: 'commands_data', payload: { commands } });
    } catch (err) {
      this.messenger.postError(err);
    }
  }

  public abort(): void {
    this.question.cancelAll();
    this.clearReplyQueue();

    if (this.session) {
      void this.session.abort().catch((err) => {
        logger.error('Failed to abort session:', err);
      });
    }
  }

  public dispose(): void {
    this.messenger.dispose();
    this.cleanupSession();
    this.question.cancelAll();
    this.clearReplyQueue();
  }

  public getSessionFile(): string | undefined {
    return this.session?.sessionFile;
  }

  private prepareRun(webview: Webview): void {
    this.messenger.attach(webview);
    this.question.cancelAll();
    this.event.resetTurnState();
  }

  private async prepareSession(
    webview: Webview,
    path: string | undefined,
    selectedModel: Pick<ModelItem, 'id' | 'provider'> | undefined,
  ): Promise<{ session: AgentSession; envDetails: string }> {
    this.prepareRun(webview);
    const cwd = getWorkspaceCwd();

    const session = await this.getOrCreateSession(path, cwd);

    // Apply and persist the model chosen in the footer before prompting.
    await this.applySelectedModel(session, selectedModel);

    const isNewSession = session.agent.state.messages.length === 0;
    const envDetails = await getEnvironmentDetails(session, cwd, isNewSession);
    return { session, envDetails };
  }

  private async getOrCreateSession(path: string | undefined, cwd: string): Promise<AgentSession> {
    if (this.session && (!path || this.session.sessionFile === path)) {
      return this.session;
    }

    this.cleanupSession();

    const session = await createSession(cwd, path);
    this.session = session;

    this.setupTerminationHook(session);
    this.setupReplyQueueHook(session);
    this.subscribeToSessionEvents(session);

    return session;
  }

  private async applySelectedModel(session: AgentSession, selectedModel: Pick<ModelItem, 'id' | 'provider'> | undefined): Promise<void> {
    if (!selectedModel || !selectedModel.id || !selectedModel.provider) return;

    const model = session.modelRuntime.getModel(selectedModel.provider, selectedModel.id);
    if (!model) return;

    try {
      await session.setModel(model);
    } catch (err) {
      logger.warn(`Could not apply selected model ${selectedModel.provider}/${selectedModel.id}:`, err);
    }
  }

  private setupTerminationHook(session: AgentSession): void {
    const baseAfterToolCall = session.agent.afterToolCall;
    session.agent.afterToolCall = async (props): Promise<AfterToolCallResult> => {
      const baseResult = (await baseAfterToolCall?.(props)) ?? {};
      if (props.toolCall.name === 'attempt_completion') {
        // The completion tool ends the turn by contract, so tell Pi to stop
        // the agent loop rather than letting it request another completion.
        return { ...baseResult, terminate: true };
      }
      return baseResult;
    };
  }

  private setupReplyQueueHook(session: AgentSession): void {
    const basePrepareNextTurn = session.agent.prepareNextTurnWithContext;
    session.agent.prepareNextTurnWithContext = async (context, signal) => {
      const snapshot = await basePrepareNextTurn?.(context, signal);

      if (this.replyQueue.length > 0) {
        const undelivered: QueueMessage[] = [];

        for (const msg of this.replyQueue) {
          const attachments = parseImageAttachments(msg.images);
          const content: (TextContent | ImageContent)[] = [{ type: 'text', text: msg.text }];
          if (attachments) {
            content.push(...attachments);
          }

          try {
            session.agent.steer({ role: 'user', content, timestamp: msg.ts });
          } catch (err) {
            logger.error('Failed to steer queued reply, keeping it for later:', err);
            undelivered.push(msg);
          }
        }

        // Only drop the messages that were actually delivered; failed ones
        // stay queued and are retried on the next turn.
        this.replyQueue = undelivered;
        this.broadcastReplyQueue();
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
    const message = this.event.mapEvent(event, session);
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

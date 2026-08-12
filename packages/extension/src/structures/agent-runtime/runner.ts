import { uuidv7 } from '@earendil-works/pi-ai';

import { readAppSettings } from '@pi-code/extension/core/settings';
import { cancelAllQuestions } from '@pi-code/extension/structures/agent-runtime/brokers/question';
import { EventMapper } from '@pi-code/extension/structures/agent-runtime/event';
import { createSession } from '@pi-code/extension/structures/agent-runtime/session';
import { WebviewMessenger } from '@pi-code/extension/structures/agent-runtime/webview';
import { listCommands } from '@pi-code/extension/structures/chat-command/command';
import { getEnvironmentDetails, getLatestTodoList, withTodoProgress } from '@pi-code/extension/structures/chat-session/environment';
import { loadSessionTranscript } from '@pi-code/extension/structures/chat-session/session';
import { parseBase64DataUrl } from '@pi-code/extension/utilities/codec';
import { getWorkspaceCwd } from '@pi-code/extension/utilities/vscode';
import { DEFAULT_CONTEXT_LIMIT } from '@pi-code/shared/core/constants';
import { logger } from '@pi-code/shared/core/logger';

import type { AfterToolCallResult } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';
import type { ChatMessage, ExtensionToWebviewMessage, ModelSelection, QueueMessage, StatsData } from '@pi-code/shared/core/protocol';

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

  private readonly event = new EventMapper();
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
          this.messenger.postError(err);
        });
    } catch (err) {
      this.messenger.postError(err);
    }
  }

  public async compact(path: string | undefined): Promise<{ messages: ChatMessage[]; stats: StatsData } | null> {
    this.prepareRun();
    const cwd = getWorkspaceCwd();

    try {
      const session = await this.getOrCreateSession(path, cwd);
      await session.compact();

      // Returns the compacted transcript and its stats so the caller can refresh the
      // webview from the in-memory session instead of re-opening the file on disk.
      const entries = session.sessionManager.buildContextEntries();
      return loadSessionTranscript(entries, session.model?.contextWindow ?? DEFAULT_CONTEXT_LIMIT);
    } catch (err) {
      this.messenger.postError(err);
      return null;
    }
  }

  public async reload(): Promise<void> {
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

  public reset(): void {
    this.cleanupSession();
    cancelAllQuestions();
    this.clearReplyQueue();
  }

  public abort(): void {
    cancelAllQuestions();
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
    cancelAllQuestions();
    this.clearReplyQueue();
  }

  public getSessionFile(): string | undefined {
    return this.session?.sessionFile;
  }

  private prepareRun(): void {
    cancelAllQuestions();
    this.event.resetTurnState();
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

    this.setupTerminationHook(session);
    this.setupReplyQueueHook(session);
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

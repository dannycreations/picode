import { uuidv7 } from '@earendil-works/pi-ai';
import { window } from 'vscode';

import { getSettingsManager, readAppSettings } from '@pi-code/extension/core/settings';
import { cancelAllApprovals } from '@pi-code/extension/structures/agent-runtime/brokers/approval';
import { cancelAllQuestions } from '@pi-code/extension/structures/agent-runtime/brokers/question';
import { mapEvent } from '@pi-code/extension/structures/agent-runtime/event';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { applyCompactionSettings, createSession } from '@pi-code/extension/structures/agent-runtime/session';
import { injectSkillMessages } from '@pi-code/extension/structures/agent-runtime/skill';
import { WebviewMessenger } from '@pi-code/extension/structures/agent-runtime/webview';
import { collectCommands } from '@pi-code/extension/structures/chat-command/command';
import { expandMentions } from '@pi-code/extension/structures/chat-command/mention';
import { getEnvironmentDetails, getLatestTodoList, withTodoProgress } from '@pi-code/extension/structures/chat-session/environment';
import { loadSessionTranscript } from '@pi-code/extension/structures/chat-session/session';
import { parseBase64DataUrl } from '@pi-code/extension/utilities/codec';
import { getWorkspaceCwd } from '@pi-code/extension/utilities/vscode';
import { logger } from '@pi-code/shared/core/logger';
import { EMPTY_STATS } from '@pi-code/shared/utilities/common';

import type { ImageContent, ModelThinkingLevel, TextContent } from '@earendil-works/pi-ai';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';
import type { ExtensionToWebviewMessage, ModelSelection } from '@pi-code/shared/core/protocol';
import type { ChatMessage, StatsData } from '@pi-code/shared/core/types';

const COMPACTION_ABORT_ERROR_NAME = 'AbortError';
const COMPACTION_CANCEL_MESSAGE = 'Compaction cancelled';

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
  private replyQueue: ChatMessage[] = [];
  private apiRequestId: string | null = null;
  private compacting = false;
  private continueAfterCompaction = false;

  private readonly messenger = new WebviewMessenger();

  public constructor(webview: Webview) {
    this.messenger.attach(webview);
  }

  public postMessage(message: ExtensionToWebviewMessage): void {
    this.messenger.post(message);
  }

  public addToReplyQueue(text: string, images?: string[]): void {
    const msg: ChatMessage = {
      id: uuidv7(),
      sender: 'queue',
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

  public async startTask(promptText: string, images?: string[], path?: string): Promise<void> {
    this.clearReplyQueue();

    try {
      const { session, envDetails } = await this.prepareSession(path);
      const services = await createAgentResources(getWorkspaceCwd());
      const skills = services.resourceLoader.getSkills().skills;

      const expanded = await expandMentions(promptText, getWorkspaceCwd());

      // The mention content reaches the model but stays out of the rendered
      // transcript, so the user's message keeps the clean `@token`.
      if (expanded.mentionContent) {
        await session.sendCustomMessage(
          {
            customType: 'mention_content',
            content: expanded.mentionContent,
            display: false,
          },
          { deliverAs: 'nextTurn' },
        );
      }

      // `nextTurn` makes pi attach the details to the upcoming user message, so
      // they reach the model and get persisted with the turn that used them.
      await session.sendCustomMessage(
        {
          customType: 'environment_details',
          content: envDetails,
          display: false,
        },
        { deliverAs: 'nextTurn' },
      );

      // Move any `/skill:name` invocation into its own hidden message before the
      // user turn, leaving the user message clean. The returned text is the
      // skill args (or the original text when there is no skill invocation).
      const userText = await injectSkillMessages(session, skills, expanded.text);

      const attachments = parseImageAttachments(images);
      void session.prompt(userText, { images: attachments }).catch((err) => {
        this.messenger.postError(err);
      });
    } catch (err) {
      this.messenger.postError(err);
    }
  }

  public async continueTask(path: string): Promise<void> {
    try {
      const { session, envDetails } = await this.prepareSession(path);

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

    this.compacting = true;
    this.messenger.post({ type: 'compaction_start' });
    try {
      const session = await this.getOrCreateSession(path, cwd);
      const compaction = await session.compact();

      // Returns the compacted transcript and its stats so the caller can refresh the
      // webview from the in-memory session instead of re-opening the file on disk.
      const entries = session.sessionManager.buildContextEntries();
      const transcript = loadSessionTranscript(entries, session.model?.contextWindow ?? EMPTY_STATS.contextLimit);
      // loadSessionTranscript derives contextTokens from the last assistant usage,
      // which is the pre-compaction size once the context is rebuilt. Use the
      // library's post-compaction estimate so the header reflects the shrink
      // without waiting for the next prompt.
      if (typeof compaction?.estimatedTokensAfter === 'number') {
        return {
          messages: transcript.messages,
          stats: { ...transcript.stats, contextTokens: compaction.estimatedTokensAfter },
        };
      }
      return transcript;
    } catch (err) {
      // A user cancel aborts the in-flight compaction, which the session
      // rethrows as an AbortError. Don't surface that as a spurious error
      // bubble: the deliberate stop is already signaled by compaction_end.
      const isAbort = err instanceof Error && (err.name === COMPACTION_ABORT_ERROR_NAME || err.message === COMPACTION_CANCEL_MESSAGE);
      if (!isAbort) {
        this.messenger.postError(err);
      }
      return null;
    } finally {
      this.compacting = false;
      this.messenger.post({ type: 'compaction_end' });
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

      const services = await createAgentResources(getWorkspaceCwd());
      const commands = collectCommands(services.resourceLoader);
      this.messenger.post({ type: 'commands_data', payload: { commands } });
    } catch (err) {
      this.messenger.postError(err);
    }
  }

  public applyModelAndThinking(selection: ModelSelection, level?: ModelThinkingLevel): void {
    const manager = getSettingsManager(getWorkspaceCwd());
    if (selection.id && selection.provider) {
      manager.setDefaultModelAndProvider(selection.provider, selection.id);
    }
    if (level) {
      manager.setDefaultThinkingLevel(level);
    }
  }

  public async cancelTask(): Promise<void> {
    this.cleanupPending();
    this.clearReplyQueue();
    this.continueAfterCompaction = false;
    if (!this.session) return;

    const session = this.session;
    this.session = null;

    try {
      await session.abort();
    } catch (err) {
      logger.warn('Failed to abort session on cancel:', err);
    } finally {
      this.unsubscribeSessionEvents?.();
      this.unsubscribeSessionEvents = null;
      session.dispose();
    }
  }

  public dispose(): void {
    this.messenger.dispose();
    this.cleanupSession();
    this.cleanupPending();
    this.clearReplyQueue();
  }

  private prepareRun(): void {
    this.cleanupPending();
    this.apiRequestId = null;
    this.continueAfterCompaction = false;
  }

  public getSessionFile(): string | undefined {
    return this.session?.sessionFile;
  }

  private async prepareSession(path: string | undefined): Promise<{ session: AgentSession; envDetails: string }> {
    this.prepareRun();
    const cwd = getWorkspaceCwd();

    const session = await this.getOrCreateSession(path, cwd);

    await this.setModelAndThinking(session);

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
    this.unsubscribeSessionEvents = session.subscribe((event) => this.handleSessionEvent(event, session));

    return session;
  }

  private handleSessionEvent(event: AgentSessionEvent, session: AgentSession): void {
    // A percent or overflow auto-compaction that finished without a built-in
    // retry leaves the upstream loop stopped unless queued messages exist.
    // Remember it so we resume the agent on settle and the task keeps running.
    if (event.type === 'compaction_end' && !this.compacting && !event.aborted && !event.willRetry) {
      this.continueAfterCompaction = true;
    }

    if (event.type === 'agent_settled' || event.type === 'agent_end') {
      if (this.continueAfterCompaction && this.session?.sessionFile) {
        this.continueAfterCompaction = false;
        // Resume the agent so a successful auto-compaction does not halt the
        // work. The re-triggered turn delivers any queued replies and clears
        // the queue on its own settle, so leave it intact here.
        void this.continueTask(this.session.sessionFile);
      } else {
        this.clearReplyQueue();
      }
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

  private setupSessionHook(session: AgentSession): void {
    const sessionManager = session.sessionManager;
    const baseAppendMessage = sessionManager.appendMessage.bind(sessionManager);
    sessionManager.appendMessage = (message): string => {
      // Ignore "Request aborted" message triggered by cancelTask() > abort()
      if (!this.session && message.role === 'assistant' && message.stopReason === 'aborted') {
        return uuidv7();
      }
      return baseAppendMessage(message);
    };

    const baseShouldStop = session.agent.shouldStopAfterTurn;
    session.agent.shouldStopAfterTurn = (context, signal): boolean | Promise<boolean> => {
      if (!this.session || signal?.aborted) return true;
      return baseShouldStop?.(context) ?? false;
    };

    const basePrepareContext = session.agent.prepareNextTurnWithContext;
    session.agent.prepareNextTurnWithContext = async (context, signal) => {
      await this.setModelAndThinking(session);

      const snapshot = await basePrepareContext?.(context, signal);
      const cwd = getWorkspaceCwd();

      if (this.replyQueue.length > 0) {
        const undelivered: ChatMessage[] = [];
        const delivered: ChatMessage[] = [];

        for (const msg of this.replyQueue) {
          if (msg.sender !== 'queue') {
            undelivered.push(msg);
            continue;
          }

          if (await this.steerQueuedReply(msg, cwd, session, msg.images)) {
            delivered.push({ id: msg.id, sender: 'user', text: msg.text, images: msg.images, ts: msg.ts });
          } else {
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

  private async steerQueuedReply(msg: ChatMessage, cwd: string, session: AgentSession, images: string[] | undefined): Promise<boolean> {
    try {
      const attachments = parseImageAttachments(images);
      const expanded = await expandMentions(msg.text, cwd);
      const content: (TextContent | ImageContent)[] = [{ type: 'text', text: expanded.text }];
      if (attachments) {
        content.push(...attachments);
      }
      session.agent.steer({ role: 'user', content, timestamp: msg.ts });

      // Same as startTask: keep the mention content out of the displayed
      // message by delivering it as a hidden custom message on the same turn.
      if (expanded.mentionContent) {
        await session.sendCustomMessage({ customType: 'mention_content', content: expanded.mentionContent, display: false }, { deliverAs: 'steer' });
      }
      return true;
    } catch (err) {
      logger.error('Failed to steer queued reply, keeping it for later:', err);
      return false;
    }
  }

  private async setModelAndThinking(session: AgentSession): Promise<void> {
    // Honor whatever the footer shows rather than a transient selection: read
    // the persisted model and thinking level and apply them to the session.
    const manager = getSettingsManager(getWorkspaceCwd());

    const provider = manager.getDefaultProvider();
    const modelId = manager.getDefaultModel();
    if (provider && modelId && (session.model?.id !== modelId || session.model?.provider !== provider)) {
      const model = session.modelRuntime.getModel(provider, modelId);
      if (model) {
        try {
          await session.setModel(model);
        } catch (err) {
          logger.warn(`Could not apply persisted model ${provider}/${modelId}:`, err);
        }
      }
    }

    const level = manager.getDefaultThinkingLevel();
    if (level && session.thinkingLevel !== level) {
      try {
        session.setThinkingLevel(level);
      } catch (err) {
        logger.warn(`Could not apply persisted thinking level ${level}:`, err);
      }
    }

    applyCompactionSettings(session);
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

  private cleanupPending(): void {
    cancelAllQuestions();
    cancelAllApprovals();
  }
}

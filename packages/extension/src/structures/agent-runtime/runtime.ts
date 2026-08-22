import { cancelAllApprovals } from '@pi-code/extension/structures/agent-runtime/brokers/approval';
import { cancelAllQuestions } from '@pi-code/extension/structures/agent-runtime/brokers/question';
import { Messenger } from '@pi-code/extension/structures/agent-runtime/core/messenger';
import { ReplyQueue } from '@pi-code/extension/structures/agent-runtime/core/reply-queue';
import { mapEvent } from '@pi-code/extension/structures/agent-runtime/event';
import { applyPersistedModelAndThinking } from '@pi-code/extension/structures/agent-runtime/helpers/model-selection';
import { initSessionHooks } from '@pi-code/extension/structures/agent-runtime/hooks';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { createSession } from '@pi-code/extension/structures/agent-runtime/session';
import { injectSkillMessages } from '@pi-code/extension/structures/agent-runtime/skill';
import { collectCommands } from '@pi-code/extension/structures/chat-command/command';
import { expandMentions } from '@pi-code/extension/structures/chat-command/mention';
import { getEnvironmentDetails } from '@pi-code/extension/structures/chat-session/environment';
import { loadSessionTranscript } from '@pi-code/extension/structures/chat-session/session';
import { parseBase64DataUrl } from '@pi-code/extension/utilities/codec';
import { getWorkspaceCwd } from '@pi-code/extension/utilities/vscode';
import { logger } from '@pi-code/shared/core/logger';
import { resolveContextLimit } from '@pi-code/shared/utilities/common';

import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { AgentSession, AgentSessionEvent, AgentSessionServices } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';
import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';
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

export class Runtime {
  private session: AgentSession | null = null;
  private unsubscribeSessionEvents: (() => void) | null = null;
  private apiRequestId: string | null = null;
  private compacting = false;
  private continueAfterCompaction = false;

  private readonly messenger: Messenger;
  public readonly replyQueue: ReplyQueue;

  public constructor(webview: Webview) {
    this.messenger = new Messenger(webview);
    this.replyQueue = new ReplyQueue((messages) => {
      this.messenger.post({ type: 'reply_queue_data', payload: { queue: [...messages] } });
    });
  }

  public postMessage(message: ExtensionToWebviewMessage): void {
    this.messenger.post(message);
  }

  public async startTask(promptText: string, images?: string[], path?: string): Promise<void> {
    this.replyQueue.clear();

    try {
      const { session, envDetails, services } = await this.prepareSession(path);
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
      const transcript = loadSessionTranscript(entries, resolveContextLimit(session.model?.contextWindow));
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

  public async reload(): Promise<'busy' | 'reloaded'> {
    if (this.session?.isStreaming || this.session?.isCompacting) {
      return 'busy';
    }

    await this.session?.reload();

    const services = await createAgentResources(getWorkspaceCwd());
    const commands = collectCommands(services.resourceLoader);
    this.messenger.post({ type: 'commands_data', payload: { commands } });
    return 'reloaded';
  }

  public async cancelTask(): Promise<void> {
    this.cleanupPending();
    this.replyQueue.clear();
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
    this.replyQueue.clear();
  }

  private prepareRun(): void {
    this.cleanupPending();
    this.apiRequestId = null;
    this.continueAfterCompaction = false;
  }

  public getSessionFile(): string | undefined {
    return this.session?.sessionFile;
  }

  private async prepareSession(path: string | undefined): Promise<{
    session: AgentSession;
    envDetails: string;
    services: AgentSessionServices;
  }> {
    this.prepareRun();
    const cwd = getWorkspaceCwd();

    // Skills come from the same cached resources the session was built with,
    // so one fetch serves both instead of resolving resources twice.
    const session = await this.getOrCreateSession(path, cwd);
    const services = await createAgentResources(cwd);

    await applyPersistedModelAndThinking(session);

    const isNewSession = session.agent.state.messages.length === 0;
    const envDetails = await getEnvironmentDetails(cwd, isNewSession);
    return { session, envDetails, services };
  }

  private async getOrCreateSession(path: string | undefined, cwd: string): Promise<AgentSession> {
    if (this.session && (!path || this.session.sessionFile === path)) {
      return this.session;
    }

    this.cleanupSession();

    const session = await createSession(cwd, path);
    this.session = session;

    this.bindSessionHooks(session);
    this.unsubscribeSessionEvents = session.subscribe((event) => this.handleSessionEvent(event, session));

    return session;
  }

  private bindSessionHooks(session: AgentSession): void {
    initSessionHooks(session, {
      isTaskCancelled: () => !this.session,
      prepareTurn: (target) => applyPersistedModelAndThinking(target),
      contextPrepared: (target) => this.drainQueuedReplies(target),
    });
  }

  private async drainQueuedReplies(session: AgentSession): Promise<void> {
    const pending = this.replyQueue.all();
    if (pending.length === 0) return;

    const cwd = getWorkspaceCwd();
    const undelivered: ChatMessage[] = [];
    const delivered: ChatMessage[] = [];

    for (const msg of pending) {
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
    this.replyQueue.retain(undelivered);
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
        this.replyQueue.clear();
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

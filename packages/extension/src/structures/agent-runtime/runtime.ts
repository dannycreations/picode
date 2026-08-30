import { readAppSettings } from '@pi-code/extension/core/settings';
import { cancelAllApprovals } from '@pi-code/extension/structures/agent-runtime/brokers/approval';
import { cancelAllQuestions } from '@pi-code/extension/structures/agent-runtime/brokers/question';
import { Messenger } from '@pi-code/extension/structures/agent-runtime/core/messenger';
import { ReplyQueue } from '@pi-code/extension/structures/agent-runtime/core/reply-queue';
import { mapEvent } from '@pi-code/extension/structures/agent-runtime/event';
import { applyPersistedModelAndThinking } from '@pi-code/extension/structures/agent-runtime/helpers/model-selection';
import { initSessionHooks } from '@pi-code/extension/structures/agent-runtime/hooks';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { createSession } from '@pi-code/extension/structures/agent-runtime/session';
import { collectCommands } from '@pi-code/extension/structures/chat-command/command';
import { injectResourceMessages, sendHiddenContent } from '@pi-code/extension/structures/chat-command/invocation';
import { expandMentions } from '@pi-code/extension/structures/chat-command/mention';
import { getEnvironmentDetails } from '@pi-code/extension/structures/chat-session/environment';
import { loadSessionTranscript } from '@pi-code/extension/structures/chat-session/session';
import { parseAttachments } from '@pi-code/extension/utilities/codec';
import { getWorkspaceCwd } from '@pi-code/extension/utilities/vscode';
import { logger } from '@pi-code/shared/core/logger';
import { formatTextAttachment, resolveContextLimit } from '@pi-code/shared/utilities/common';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, TextContent } from '@earendil-works/pi-ai';
import type { AgentSession, AgentSessionEvent, AgentSessionServices } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';
import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';
import type { Attachment, ChatMessage, QueueChatMessage, StatsData, TextAttachment } from '@pi-code/shared/core/types';

export class Runtime {
  private session: AgentSession | null = null;
  private unsubscribeSessionEvents: (() => void) | null = null;
  private apiRequestId: string | null = null;
  private compacting = false;
  private runEndedWithError = false;
  private taskGeneration = 0;

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

  public async startTask(promptText: string, attachments?: readonly Attachment[], path?: string): Promise<void> {
    const generation = ++this.taskGeneration;
    this.replyQueue.clear();
    logger.debug(`Starting task: ${promptText.length} chars, ${attachments?.length ?? 0} attachment(s), session target ${path ?? 'current'}.`);

    try {
      const { session, envDetails, services } = await this.prepareSession(path);
      if (this.discardIfStale(generation, session)) return;

      const skills = services.resourceLoader.getSkills().skills;
      const prompts = services.resourceLoader.getPrompts().prompts;
      const expanded = await expandMentions(promptText, getWorkspaceCwd());

      // Send `/skill:` and `/prompt:` command content as hidden messages
      // before the user turn; the user message itself is passed through.
      await injectResourceMessages(session, { skills, prompts }, expanded.text);

      const textAttachments = (attachments ?? []).filter((attachment): attachment is TextAttachment => attachment.kind === 'text');
      for (const attachment of textAttachments) {
        await sendHiddenContent(session, 'text_attachment', formatTextAttachment(attachment), { deliverAs: 'nextTurn' });
      }

      if (expanded.mentionContent) {
        await sendHiddenContent(session, 'mention_content', expanded.mentionContent, { deliverAs: 'nextTurn' });
      }

      await sendHiddenContent(session, 'environment_details', envDetails, { deliverAs: 'nextTurn' });

      const imageAttachments = parseAttachments(attachments);

      if (this.discardIfStale(generation, session)) return;

      await this.compactContextIfNeeded(session);

      void session.prompt(expanded.text, { images: imageAttachments, expandPromptTemplates: false }).catch((err) => {
        this.messenger.postError(err);
      });
    } catch (err) {
      // A cancel landing mid-preparation makes the disposed session throw here;
      // that is the deliberate stop already reported by cancelTask.
      if (generation !== this.taskGeneration) {
        logger.debug('Task start abandoned after cancel:', err);
        return;
      }
      this.messenger.postError(err);
    }
  }

  public async continueTask(path: string): Promise<void> {
    const generation = ++this.taskGeneration;
    logger.debug(`Continuing task from session ${path}.`);
    try {
      const { session, envDetails } = await this.prepareSession(path);
      if (this.discardIfStale(generation, session)) return;

      await this.compactContextIfNeeded(session);

      void sendHiddenContent(session, 'environment_details', envDetails, { triggerTurn: true }).catch((err) => {
        this.messenger.postError(err);
      });
    } catch (err) {
      if (generation !== this.taskGeneration) {
        logger.debug('Task continuation abandoned after cancel:', err);
        return;
      }
      this.messenger.postError(err);
    }
  }

  public async compact(path: string | undefined): Promise<{ messages: ChatMessage[]; stats: StatsData } | null> {
    this.prepareRun();
    const cwd = getWorkspaceCwd();

    const { session } = await this.getOrCreateSession(path, cwd);
    return this.runCompaction(session);
  }

  private async runCompaction(session: AgentSession): Promise<{ messages: ChatMessage[]; stats: StatsData } | null> {
    this.compacting = true;
    this.messenger.post({ type: 'compaction_start' });
    try {
      const compaction = await session.compact();

      const entries = session.sessionManager.buildContextEntries();
      const transcript = loadSessionTranscript(entries, resolveContextLimit(session.model?.contextWindow));

      // loadSessionTranscript derives contextTokens from the last assistant usage,
      // which is the pre-compaction size once the context is rebuilt. Use the
      // session's post-compaction estimate so the header reflects the shrink.
      const stats: StatsData =
        typeof compaction?.estimatedTokensAfter === 'number'
          ? { ...transcript.stats, contextTokens: compaction.estimatedTokensAfter }
          : transcript.stats;

      return { messages: transcript.messages, stats };
    } catch (err) {
      // A user cancel aborts the in-flight compaction, which the session rethrows
      // as an AbortError. Don't surface that as a spurious error bubble.
      const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message === 'Compaction cancelled');
      if (!isAbort) {
        this.messenger.postError(err);
      }
      return null;
    } finally {
      this.compacting = false;
      this.messenger.post({ type: 'compaction_end' });
    }
  }

  private async compactContextIfNeeded(session: AgentSession): Promise<void> {
    if (!this.isContextAtCompactionThreshold(session)) return;
    await this.runCompaction(session);
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
    // Invalidate any task preparation still awaiting its session so it cannot
    // start prompting after the cancel.
    this.taskGeneration++;
    const wasRunning = this.session?.isStreaming ?? false;

    this.cleanupPending();
    this.replyQueue.clear();

    const session = this.session;
    this.session = null;
    if (session) {
      logger.debug('Cancelling task.');
      try {
        await session.abort();
      } catch (err) {
        logger.warn('Failed to abort session on cancel:', err);
      } finally {
        this.cleanupSession(session);
      }
    }

    // Aborting an idle session emits no events, so a cancel that lands before
    // the API request must settle the webview itself.
    if (!wasRunning) {
      this.messenger.post({ type: 'agent_settled' });
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
  }

  private discardIfStale(generation: number, session: AgentSession): boolean {
    if (generation === this.taskGeneration) return false;
    if (this.session === session) this.cleanupSession(session);
    return true;
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

    // Skills come from the exact resources the session was built with, so one
    // fetch serves both instead of resolving resources twice.
    const { session, services } = await this.getOrCreateSession(path, cwd);

    await applyPersistedModelAndThinking(session);

    const isNewSession = session.agent.state.messages.length === 0;
    const envDetails = await getEnvironmentDetails(cwd, isNewSession);
    return { session, envDetails, services };
  }

  private async getOrCreateSession(path: string | undefined, cwd: string): Promise<{ session: AgentSession; services: AgentSessionServices }> {
    if (this.session && (!path || this.session.sessionFile === path)) {
      logger.debug('Reusing existing agent session.');
      return { session: this.session, services: await createAgentResources(cwd) };
    }

    this.cleanupSession();

    const { session, services } = await createSession(cwd, path);
    this.session = session;
    logger.debug(`Created agent session${path ? ` from ${path}` : ' for the workspace'}.`);

    this.bindSessionHooks(session);
    this.unsubscribeSessionEvents = session.subscribe((event) => this.handleSessionEvent(event, session));

    return { session, services };
  }

  private bindSessionHooks(session: AgentSession): void {
    initSessionHooks(session, {
      isDisposed: () => !this.session,
      isCompacting: () => this.compacting,
      prepareTurn: (target) => applyPersistedModelAndThinking(target),
      isContextAboveThreshold: (target) => this.isContextAtCompactionThreshold(target),
      requestCompaction: async (target) => {
        if (!this.isContextAtCompactionThreshold(target)) return;
        this.taskGeneration++;

        await this.runCompaction(session);
        if (this.session === session && session.sessionFile) {
          void this.continueTask(session.sessionFile);
        }
      },
      contextPrepared: (target) => this.drainQueuedReplies(target),
    });
  }

  private async drainQueuedReplies(session: AgentSession): Promise<AgentMessage[]> {
    const pending = this.replyQueue.all();
    if (pending.length === 0) return [];

    const cwd = getWorkspaceCwd();
    const undelivered: ChatMessage[] = [];
    const delivered: ChatMessage[] = [];
    const mentions: AgentMessage[] = [];

    for (const msg of pending) {
      if (msg.sender !== 'queue') {
        undelivered.push(msg);
        continue;
      }

      const result = await this.steerQueuedReply(msg, cwd, session);
      if (result.steered) {
        delivered.push({ id: msg.id, sender: 'user', text: msg.text, attachments: msg.attachments, ts: msg.ts });
        if (result.mention) {
          mentions.push(result.mention);
        }
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
    return mentions;
  }

  private handleSessionEvent(event: AgentSessionEvent, session: AgentSession): void {
    if (event.type === 'agent_end') {
      this.runEndedWithError = event.messages.some((m) => m.role === 'assistant' && m.stopReason === 'error');
    }

    if (event.type === 'agent_settled' || event.type === 'agent_end') {
      if (this.runEndedWithError && this.session?.sessionFile && this.isContextAtCompactionThreshold(this.session)) {
        this.runEndedWithError = false;
        // Resume the agent; continueTask compacts again if the limit is still exceeded.
        void this.continueTask(this.session.sessionFile);
      } else if (!this.runEndedWithError) {
        this.replyQueue.clear();
      }
      this.runEndedWithError = false;
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

  private isContextAtCompactionThreshold(session: AgentSession): boolean {
    const settings = readAppSettings();
    if (!settings.autoCompactContext) return false;

    const usage = session.getContextUsage?.();
    if (!usage || usage.tokens === null || usage.contextWindow <= 0) return false;

    const threshold = settings.autoCompactContextPercent ?? 100;
    return usage.tokens > (usage.contextWindow * threshold) / 100;
  }

  private async steerQueuedReply(msg: QueueChatMessage, cwd: string, session: AgentSession): Promise<{ steered: boolean; mention?: AgentMessage }> {
    try {
      const imageAttachments = parseAttachments(msg.attachments);
      const expanded = await expandMentions(msg.text, cwd);

      const textAttachments = (msg.attachments ?? []).filter((attachment): attachment is TextAttachment => attachment.kind === 'text');
      for (const attachment of textAttachments) {
        await sendHiddenContent(session, 'text_attachment', formatTextAttachment(attachment), { triggerTurn: false });
      }

      const content: (TextContent | ImageContent)[] = [{ type: 'text', text: expanded.text }];
      if (imageAttachments) {
        content.push(...imageAttachments);
      }
      session.agent.steer({ role: 'user', content, timestamp: msg.ts });

      if (expanded.mentionContent) {
        await sendHiddenContent(session, 'mention_content', expanded.mentionContent, { triggerTurn: false });
        return {
          steered: true,
          mention: {
            role: 'custom',
            customType: 'mention_content',
            content: expanded.mentionContent,
            display: false,
            timestamp: Date.now(),
          } as AgentMessage,
        };
      }
      return { steered: true };
    } catch (err) {
      logger.error('Failed to steer queued reply, keeping it for later:', err);
      return { steered: false };
    }
  }

  private cleanupSession(session?: AgentSession): void {
    const unsubscribe = this.unsubscribeSessionEvents;
    this.unsubscribeSessionEvents = null;

    if (unsubscribe) {
      try {
        unsubscribe();
      } catch (err) {
        logger.error('Failed to unsubscribe session events during cleanup:', err);
      }
    }

    try {
      session?.dispose();
    } catch (err) {
      logger.error('Failed to dispose session during cleanup:', err);
    }
    this.session = null;
  }

  private cleanupPending(): void {
    cancelAllQuestions();
    cancelAllApprovals();
  }
}

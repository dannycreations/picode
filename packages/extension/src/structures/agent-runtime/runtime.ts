import { readAppSettings } from '@pi-code/extension/core/settings';
import { cancelAllApprovals } from '@pi-code/extension/structures/agent-runtime/brokers/approval';
import { cancelAllQuestions } from '@pi-code/extension/structures/agent-runtime/brokers/question';
import { Messenger } from '@pi-code/extension/structures/agent-runtime/core/messenger';
import { ReplyQueue } from '@pi-code/extension/structures/agent-runtime/core/reply-queue';
import { mapEvent } from '@pi-code/extension/structures/agent-runtime/event';
import { appendAgentMessage } from '@pi-code/extension/structures/agent-runtime/helpers/agent-message';
import { applyPersistedModelAndThinking } from '@pi-code/extension/structures/agent-runtime/helpers/model-selection';
import { initSessionHooks } from '@pi-code/extension/structures/agent-runtime/hooks';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { createSession } from '@pi-code/extension/structures/agent-runtime/session';
import { collectCommands } from '@pi-code/extension/structures/chat-command/command';
import { injectResourceMessages } from '@pi-code/extension/structures/chat-command/invocation';
import { expandMentions } from '@pi-code/extension/structures/chat-command/mention';
import { getEnvironmentDetails } from '@pi-code/extension/structures/chat-session/environment';
import { loadSessionTranscript } from '@pi-code/extension/structures/chat-session/session';
import { parseAttachments } from '@pi-code/extension/utilities/codec';
import { getWorkspaceCwd } from '@pi-code/extension/utilities/vscode';
import { logger } from '@pi-code/shared/core/logger';
import { resolveContextLimit } from '@pi-code/shared/utilities/common';
import { wrapCodeBlock } from '@pi-code/shared/utilities/markdown';

import type { AgentSession, AgentSessionEvent, AgentSessionServices } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';
import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';
import type { Attachment, ChatMessage, QueueChatMessage, StatsData, TextAttachment } from '@pi-code/shared/core/types';

export class Runtime {
  private session: AgentSession | null = null;
  private unsubscribeSessionEvents: (() => void) | null = null;
  private apiRequestId: string | null = null;
  private compacting = false;
  private runEndedWithFailure = false;
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
      const imageAttachments = parseAttachments(attachments);

      await injectResourceMessages(session, { skills, prompts }, expanded.text);

      appendAgentMessage(session, {
        role: 'user',
        content: [{ type: 'text', text: expanded.text }, ...imageAttachments],
        timestamp: Date.now(),
      });

      const textAttachments = (attachments ?? []).filter((attachment): attachment is TextAttachment => attachment.kind === 'text');
      for (const attachment of textAttachments) {
        appendAgentMessage(session, {
          role: 'custom',
          customType: 'text_attachment',
          content: wrapCodeBlock(attachment.content, attachment.language),
          display: false,
          details: undefined,
          timestamp: Date.now(),
        });
      }

      if (expanded.mentionContent) {
        appendAgentMessage(session, {
          role: 'custom',
          customType: 'mention_content',
          content: expanded.mentionContent,
          display: false,
          details: undefined,
          timestamp: Date.now(),
        });
      }

      appendAgentMessage(session, {
        role: 'custom',
        customType: 'environment_details',
        content: envDetails,
        display: false,
        details: undefined,
        timestamp: Date.now(),
      });

      if (this.discardIfStale(generation, session)) return;

      await this.compactContextIfNeeded(session);
      const runAgentPrompt = session['_runAgentPrompt'].bind(session) as (messages: string[]) => Promise<void>;
      await runAgentPrompt([]).catch((err) => this.messenger.postError(err));
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

      appendAgentMessage(session, {
        role: 'custom',
        customType: 'environment_details',
        content: envDetails,
        display: false,
        details: undefined,
        timestamp: Date.now(),
      });

      const runAgentPrompt = session['_runAgentPrompt'].bind(session) as (messages: string[]) => Promise<void>;
      await runAgentPrompt([]).catch((err) => this.messenger.postError(err));
    } catch (err) {
      if (generation !== this.taskGeneration) {
        logger.debug('Task continuation abandoned after cancel:', err);
        return;
      }
      this.messenger.postError(err);
    }
  }

  public async fork(path: string | undefined): Promise<{ messages: ChatMessage[]; stats: StatsData } | null> {
    this.prepareRun();
    const cwd = getWorkspaceCwd();

    if (!path) {
      this.messenger.postError(new Error('Open or start a task before using /fork.'));
      return null;
    }

    const { session } = await this.getOrCreateSession(path, cwd);
    const leafId = session.sessionManager.getLeafId();
    if (!leafId) {
      this.messenger.postError(new Error('Failed to create a forked session.'));
      return null;
    }

    const branchedPath = session.sessionManager.createBranchedSession(leafId);
    if (!branchedPath) {
      this.messenger.postError(new Error('Failed to create a forked session.'));
      return null;
    }

    this.cleanupSession();

    const { session: newSession } = await createSession(cwd, branchedPath);
    this.session = newSession;

    this.bindSessionHooks(newSession);
    this.unsubscribeSessionEvents = newSession.subscribe((event) => this.handleSessionEvent(event, newSession));

    const entries = newSession.sessionManager.buildContextEntries();
    const transcript = loadSessionTranscript(entries, resolveContextLimit(newSession.model?.contextWindow));
    return { messages: transcript.messages, stats: transcript.stats };
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

      const deliveredEntry = await this.processQueuedReply(msg, cwd, session);
      if (deliveredEntry) {
        delivered.push(deliveredEntry);
      } else {
        undelivered.push(msg);
      }
    }

    if (delivered.length > 0) {
      this.messenger.post({ type: 'reply_queue_delivered', payload: { messages: delivered } });
    }

    this.replyQueue.retain(undelivered);
  }

  private handleSessionEvent(event: AgentSessionEvent, session: AgentSession): void {
    if (event.type === 'agent_end') {
      // agent_end fires at the end of every turn, not only the final one.
      // A turn that ends in error or an aborted API request (context overflow)
      // sits on a bloated context; record it so the settle below can compact
      // and resume. Keep queued replies so a later turn can still drain them.
      this.runEndedWithFailure = event.messages.some((m) => m.role === 'assistant' && (m.stopReason === 'error' || m.stopReason === 'aborted'));
    }

    if (event.type === 'agent_settled' || event.type === 'agent_end') {
      // Don't start a second compaction while one is already running, which is
      // the case when the extension itself aborts the turn to compact.
      if (this.runEndedWithFailure && !this.compacting && this.session?.sessionFile && this.isContextAtCompactionThreshold(this.session)) {
        this.runEndedWithFailure = false;
        // Resume the agent; continueTask compacts again if the limit is still exceeded.
        void this.continueTask(this.session.sessionFile);
      } else if (!this.runEndedWithFailure && event.type === 'agent_settled' && this.session?.sessionFile && this.replyQueue.all().length > 0) {
        // The agent stopped but the user queued replies while it ran. Drain
        // them into a fresh turn instead of discarding them.
        void this.continueTask(this.session.sessionFile);
      } else if (!this.runEndedWithFailure && event.type === 'agent_settled') {
        this.replyQueue.clear();
      }
      this.runEndedWithFailure = false;
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

  private async processQueuedReply(msg: QueueChatMessage, cwd: string, session: AgentSession): Promise<ChatMessage | undefined> {
    try {
      const expanded = await expandMentions(msg.text, cwd);
      const imageAttachments = parseAttachments(msg.attachments);

      appendAgentMessage(session, {
        role: 'user',
        content: [{ type: 'text', text: expanded.text }, ...imageAttachments],
        timestamp: msg.timestamp,
      });

      const textAttachments = (msg.attachments ?? []).filter((attachment): attachment is TextAttachment => attachment.kind === 'text');
      for (const attachment of textAttachments) {
        appendAgentMessage(session, {
          role: 'custom',
          customType: 'text_attachment',
          content: wrapCodeBlock(attachment.content, attachment.language),
          display: false,
          details: undefined,
          timestamp: Date.now(),
        });
      }

      if (expanded.mentionContent) {
        appendAgentMessage(session, {
          role: 'custom',
          customType: 'mention_content',
          content: expanded.mentionContent,
          display: false,
          details: undefined,
          timestamp: Date.now(),
        });
      }

      return { id: msg.id, sender: 'user', text: msg.text, attachments: msg.attachments, timestamp: msg.timestamp };
    } catch (err) {
      logger.error('Failed to process queued reply, keeping it for later:', err);
      return undefined;
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

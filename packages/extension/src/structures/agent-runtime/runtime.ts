import { readAppSettings } from '@pi-code/extension/core/settings';
import { cancelAllApprovals } from '@pi-code/extension/structures/agent-runtime/brokers/approval';
import { cancelAllQuestions } from '@pi-code/extension/structures/agent-runtime/brokers/question';
import {
  getLiveSubagent,
  liveSubagentToolCallIds,
  onSubagentSessionsChanged,
  releaseLiveSubagents,
} from '@pi-code/extension/structures/agent-runtime/brokers/subagent';
import { Messenger } from '@pi-code/extension/structures/agent-runtime/core/messenger';
import { ReplyQueue } from '@pi-code/extension/structures/agent-runtime/core/reply-queue';
import { createStats, mapEvent, toSubagentEvent } from '@pi-code/extension/structures/agent-runtime/event';
import { appendHiddenMessage, appendUserTurn } from '@pi-code/extension/structures/agent-runtime/helpers/agent-message';
import { applyPersistedModelAndThinking } from '@pi-code/extension/structures/agent-runtime/helpers/model-selection';
import { initSessionHooks } from '@pi-code/extension/structures/agent-runtime/hooks';
import { createAgentResources, invalidateAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { createSession } from '@pi-code/extension/structures/agent-runtime/session';
import { collectCommands } from '@pi-code/extension/structures/chat-command/command';
import { injectResourceMessages } from '@pi-code/extension/structures/chat-command/invocation';
import { expandMentions } from '@pi-code/extension/structures/chat-command/mention';
import { getEnvironmentDetails } from '@pi-code/extension/structures/chat-session/environment';
import { loadSessionTranscript, loadSubagentTranscript } from '@pi-code/extension/structures/chat-session/session';
import { parseAttachments } from '@pi-code/extension/utilities/codec';
import { getWorkspaceCwd } from '@pi-code/extension/utilities/vscode';
import { logger } from '@pi-code/shared/core/logger';
import { resolveContextLimit } from '@pi-code/shared/utilities/common';
import { wrapCodeBlock } from '@pi-code/shared/utilities/markdown';

import type { AgentSession, AgentSessionEvent, AgentSessionServices, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';
import type { LiveSubagent } from '@pi-code/extension/structures/agent-runtime/brokers/subagent';
import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';
import type { Attachment, ChatMessage, QueueChatMessage, StatsData, TextAttachment } from '@pi-code/shared/core/types';

export class Runtime {
  private taskGeneration = 0;
  private session: AgentSession | null = null;
  private apiRequestId: string | null = null;
  private unsubscribeSessionEvents: (() => void) | null = null;

  private subagentApiRequestId: string | null = null;
  private unsubscribeSubagentEvents: (() => void) | null = null;
  private unsubscribeSubagentSessions: (() => void) | null = null;

  private readonly messenger: Messenger;
  public readonly replyQueue: ReplyQueue;

  public constructor(webview: Webview) {
    this.messenger = new Messenger(webview);
    this.replyQueue = new ReplyQueue((messages) => {
      this.messenger.post({ type: 'reply_queue_data', payload: { queue: messages } });
    });
    // The webview offers the button that opens a sub-agent session only for
    // the calls the extension still holds a session for.
    this.unsubscribeSubagentSessions = onSubagentSessionsChanged((toolCallIds) => {
      this.publishSubagentSessions(toolCallIds);
    });
  }

  public publishSubagentSessions(toolCallIds: readonly string[] = liveSubagentToolCallIds()): void {
    this.messenger.post({ type: 'subagent_sessions', payload: { toolCallIds } });
  }

  public postMessage(message: ExtensionToWebviewMessage): void {
    this.messenger.post(message);
  }

  public async openSubagentSession(toolCallId: string): Promise<void> {
    const resolved = await this.resolveLiveSubagent(toolCallId);
    if (!resolved) return;

    this.closeSubagentSession();

    const { subagent, session } = resolved;
    const { messages, stats } = loadSubagentTranscript(session, subagent.task);

    this.unsubscribeSubagentEvents = session.subscribe((event) => {
      const { message, apiRequestId } = mapEvent(event, session, this.subagentApiRequestId);
      this.subagentApiRequestId = apiRequestId;
      if (!message) return;

      const subagentEvent = toSubagentEvent(message);
      if (subagentEvent) {
        this.messenger.post({ type: 'subagent_event', payload: { toolCallId, event: subagentEvent } });
      }
    });

    this.messenger.post({
      type: 'subagent_session_opened',
      payload: {
        toolCallId,
        task: { id: `subagent-${toolCallId}`, title: subagent.name, messages, ...stats },
        isRunning: session.isStreaming,
      },
    });
  }

  private async resolveLiveSubagent(toolCallId: string): Promise<{ subagent: LiveSubagent; session: AgentSession } | null> {
    const subagent = getLiveSubagent(toolCallId);
    if (!subagent) {
      this.messenger.postError(new Error('That sub-agent session is no longer available.'));
      return null;
    }

    // A sub-agent that is still starting has no session yet. Waiting for it is
    // better than telling the user there is nothing to open.
    const session = subagent.session ?? (await withTimeout(subagent.ready, SUBAGENT_READY_TIMEOUT_MS));
    if (!session) {
      this.messenger.postError(new Error('The sub-agent session is not ready yet.'));
      return null;
    }

    return { subagent, session };
  }

  public closeSubagentSession(): void {
    this.unsubscribeSubagentEvents?.();
    this.unsubscribeSubagentEvents = null;
    this.subagentApiRequestId = null;
  }

  public async sendSubagentMessage(toolCallId: string, text: string, attachments?: readonly Attachment[]): Promise<void> {
    const resolved = await this.resolveLiveSubagent(toolCallId);
    if (!resolved) return;

    const { session } = resolved;

    try {
      const mentionContent = await expandMentions(text, getWorkspaceCwd());
      // A sub-agent takes one message, so the files a mention points at ride
      // along with it instead of travelling as a separate hidden message.
      const mentioned = mentionContent ? `${text}\n\n${mentionContent}` : text;
      const content = [{ type: 'text' as const, text: withTextAttachments(mentioned, attachments) }, ...parseAttachments(attachments)];
      await session.sendUserMessage(content, { deliverAs: 'steer' });
    } catch (err) {
      this.messenger.postError(err);
    }
  }

  public async startTask(promptText: string, attachments?: readonly Attachment[], path?: string): Promise<void> {
    await this.runTask('Task start', async (generation) => {
      this.replyQueue.clear();
      logger.debug(`Starting task: ${promptText.length} chars, ${attachments?.length ?? 0} attachment(s), session target ${path ?? 'current'}.`);

      const { session, envDetails, services } = await this.prepareSession(path);
      if (this.discardIfStale(generation, session)) return;

      const skills = services.resourceLoader.getSkills().skills;
      const prompts = services.resourceLoader.getPrompts().prompts;
      const mentionContent = await expandMentions(promptText, getWorkspaceCwd());

      await injectResourceMessages(session, { skills, prompts }, promptText);

      appendUserTurn(session, promptText, mentionContent, attachments, Date.now());
      appendHiddenMessage(session, 'environment_details', envDetails);

      if (this.discardIfStale(generation, session)) return;

      await this.runCompaction(session);
      await session.prompt(null);
    });
  }

  public async continueTask(path: string): Promise<void> {
    await this.runTask('Task continuation', async (generation) => {
      logger.debug(`Continuing task from session ${path}.`);

      const { session, envDetails } = await this.prepareSession(path);
      if (this.discardIfStale(generation, session)) return;

      await this.runCompaction(session);

      appendHiddenMessage(session, 'environment_details', envDetails);

      // The agent loop only runs the contextPrepared hook from a run's second
      // turn on, so a drain left to that hook would miss this run's first
      // request. Deliver the queued replies here, before the run starts, or the
      // first turn responds without them (an ask_question call, say) while the
      // queue stays full and re-triggers this continuation on every settle.
      await this.drainQueuedReplies(session);

      await session.prompt(null);
    });
  }

  private async runTask(what: string, body: (generation: number) => Promise<void>): Promise<void> {
    const generation = ++this.taskGeneration;
    try {
      await body(generation);
    } catch (err) {
      if (generation !== this.taskGeneration) {
        logger.debug(`${what} abandoned after cancel:`, err);
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
    const branchedPath = leafId ? session.sessionManager.createBranchedSession(leafId) : undefined;
    if (!branchedPath) {
      this.messenger.postError(new Error('Failed to create a forked session.'));
      return null;
    }

    // Adopting the branch goes through the same path as any session swap, so the
    // old session is disposed and the new one is bound and subscribed in one place.
    const { session: newSession } = await this.getOrCreateSession(branchedPath, cwd);

    return this.snapshot(newSession).transcript;
  }

  public async compact(path: string | undefined): Promise<{ messages: ChatMessage[]; stats: StatsData } | null> {
    this.prepareRun();
    const cwd = getWorkspaceCwd();

    const { session } = await this.getOrCreateSession(path, cwd);
    return this.runCompaction(session);
  }

  private snapshot(session: AgentSession): { entries: readonly SessionEntry[]; transcript: { messages: ChatMessage[]; stats: StatsData } } {
    const entries = session.sessionManager.getBranch();
    const context = resolveContextLimit(session.model?.contextWindow);
    const transcript = loadSessionTranscript(entries, context);
    return { entries, transcript };
  }

  private async runCompaction(session: AgentSession): Promise<{ messages: ChatMessage[]; stats: StatsData } | null> {
    if (!this.isContextAtCompactionThreshold(session)) {
      return null;
    }

    this.messenger.post({ type: 'compaction_start' });
    try {
      // Ensure the summarization prompt always fits inside the context window.
      // findCutPoint() keeps the most recent N tokens and summarizes everything
      // before that cut. If N is too small relative to the window, the prefix
      // can exceed the window and the summarization API call overflows. We
      // raise N dynamically so the prefix is always safely below the window.
      const originalSettings = session.settingsManager.getCompactionSettings();
      const contextWindow = session.model?.contextWindow ?? 0;
      if (contextWindow > 0) {
        const safeKeepRecent = Math.max(20000, Math.floor(contextWindow * 0.4));
        session.settingsManager.applyOverrides({
          compaction: { ...originalSettings, keepRecentTokens: safeKeepRecent },
        });
      }

      try {
        const compaction = await session.compact();

        const { entries, transcript } = this.snapshot(session);

        let stats = createStats(session) ?? transcript.stats;
        if (typeof compaction?.estimatedTokensAfter === 'number') {
          stats = { ...stats, contextTokens: compaction.estimatedTokensAfter };
        }

        // getBranch() runs oldest to newest, so the entry just written is the last one.
        const compactionEntry = entries.findLast((entry) => entry.type === 'compaction') ?? null;
        this.messenger.post({ type: 'compaction_end', payload: { ...stats, compactionEntry } });
        return { messages: transcript.messages, stats };
      } finally {
        session.settingsManager.applyOverrides({ compaction: originalSettings });
      }
    } catch (err) {
      // A user cancel aborts the in-flight compaction, which the session rethrows
      // as an AbortError. Don't surface that as a spurious error bubble.
      const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message === 'Compaction cancelled');
      const isTooSmall = err instanceof Error && err.message === 'Nothing to compact (session too small)';
      if (!isAbort && !isTooSmall) {
        this.messenger.postError(err);
      }
      this.messenger.post({ type: 'compaction_end' });
      return null;
    }
  }

  public async reload(): Promise<'busy' | 'reloaded'> {
    if (this.session?.isStreaming || this.session?.isCompacting) {
      return 'busy';
    }

    invalidateAgentResources();
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
    this.unsubscribeSubagentSessions?.();
    this.unsubscribeSubagentSessions = null;
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
      isDisposed: () => this.session !== session,
      prepareTurn: (target) => applyPersistedModelAndThinking(target),
      isContextAboveThreshold: (target) => this.isContextAtCompactionThreshold(target),
      requestCompaction: async () => {
        this.taskGeneration++;

        const result = await this.runCompaction(session);
        if (result && this.session === session && session.sessionFile) {
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
    const delivered: ChatMessage[] = [];

    for (const msg of pending) {
      const deliveredEntry = await this.processQueuedReply(msg, cwd, session);
      if (deliveredEntry) {
        delivered.push(deliveredEntry);
      }
    }

    if (delivered.length > 0) {
      this.messenger.post({ type: 'reply_queue_delivered', payload: { messages: delivered } });
    }

    // The pass spans awaits, so the live queue can have moved on: drop only the
    // replies this pass delivered. A snapshot-based retain would discard replies
    // queued meanwhile and would resurrect entries a cancel already cleared.
    this.replyQueue.retainExcept(new Set(delivered.map((m) => m.id)));
  }

  private handleSessionEvent(event: AgentSessionEvent, session: AgentSession): void {
    if (event.type === 'agent_settled') {
      if (this.session?.sessionFile && this.replyQueue.size > 0) {
        // The agent stopped but the user queued replies while it ran. Drain
        // them into a fresh turn instead of discarding them.
        void this.continueTask(this.session.sessionFile);
      } else {
        this.replyQueue.clear();
      }
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

    const threshold = settings.autoCompactContextPercent;
    return usage.tokens > (usage.contextWindow * threshold) / 100;
  }

  private async processQueuedReply(msg: QueueChatMessage, cwd: string, session: AgentSession): Promise<ChatMessage | undefined> {
    try {
      const mentionContent = await expandMentions(msg.text, cwd);
      appendUserTurn(session, msg.text, mentionContent, msg.attachments, msg.timestamp);
      return { id: msg.id, sender: 'user', text: msg.text, attachments: msg.attachments, timestamp: msg.timestamp };
    } catch (err) {
      logger.error('Failed to process queued reply, keeping it for later:', err);
      return undefined;
    }
  }

  private cleanupSession(session: AgentSession | null = this.session): void {
    const unsubscribe = this.unsubscribeSessionEvents;
    this.unsubscribeSessionEvents = null;

    if (unsubscribe) {
      try {
        unsubscribe();
      } catch (err) {
        logger.error('Failed to unsubscribe session events during cleanup:', err);
      }
    }

    // The sub-agent sessions belong to the task that started them, so they go
    // away with it.
    this.closeSubagentSession();
    releaseLiveSubagents();

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

function withTextAttachments(text: string, attachments: readonly Attachment[] | undefined): string {
  const blocks = (attachments ?? [])
    .filter((attachment): attachment is TextAttachment => attachment.kind === 'text')
    .map((attachment) => wrapCodeBlock(attachment.content, attachment.language));
  if (blocks.length === 0) return text;
  return [text, ...blocks].join('\n\n');
}

const SUBAGENT_READY_TIMEOUT_MS = 15_000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

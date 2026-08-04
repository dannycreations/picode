import { workspace } from 'vscode';

import { EventMapper } from '@extension/structures/agent-runtime/event';
import { PolicyEvaluator } from '@extension/structures/agent-runtime/policy';
import { SessionFactory } from '@extension/structures/agent-runtime/session';
import { WebviewMessenger } from '@extension/structures/agent-runtime/webview';
import { getEnvironmentDetails } from '@extension/structures/chat-session/environment';

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';
import type { ToolName } from '@extension/types/webview';

export interface BeforeToolCallResult {
  readonly block?: boolean;
  readonly reason?: string;
}

export type ToolApprovalDecision = { action: 'approve' } | { action: 'deny'; reason: string } | { action: 'confirm' };

export interface ImageAttachment {
  readonly type: 'image';
  readonly mimeType: string;
  readonly data: string;
}

function getWorkspaceCwd(): string {
  const workspaceFolders = workspace.workspaceFolders;
  return workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : process.cwd();
}

function parseImageAttachments(images?: string[]): ImageAttachment[] | undefined {
  if (!images || images.length === 0) return undefined;

  return images
    .map((img) => {
      const match = img.match(/^data:([^;]+);base64,(.+)$/);
      return match ? { type: 'image' as const, mimeType: match[1], data: match[2] } : null;
    })
    .filter((item): item is ImageAttachment => item !== null);
}

function finalizeAttemptCompletion(session: AgentSession): void {
  const messages = session.agent.state.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      if (msg.content.some((c) => c.type === 'toolCall' && c.name === 'attempt_completion')) {
        msg.stopReason = 'stop';
        msg.rawStopReason = 'end_turn';
        break;
      }
    }
  }

  const entries = session.sessionManager.getEntries();
  let entryUpdated = false;
  for (const entry of entries) {
    if (entry.type === 'message' && entry.message.role === 'assistant') {
      const msg = entry.message;
      if (Array.isArray(msg.content)) {
        if (msg.content.some((c) => c.type === 'toolCall' && c.name === 'attempt_completion')) {
          msg.stopReason = 'stop';
          msg.rawStopReason = 'end_turn';
          entryUpdated = true;
          break;
        }
      }
    }
  }

  if (entryUpdated && typeof (session.sessionManager as any)['_rewriteFile'] === 'function') {
    try {
      (session.sessionManager as any)['_rewriteFile']();
    } catch (err) {
      console.error('Failed to rewrite session file with stopReason update:', err);
    }
  }
}

export class AgentRunner {
  private session: AgentSession | null = null;
  private pendingApprovals = new Map<string, (res: BeforeToolCallResult) => void>();
  private isAttemptCompletionAborted = false;
  private unsubscribeSessionEvents: (() => void) | null = null;

  private readonly messenger = new WebviewMessenger();
  private readonly event = new EventMapper();
  private readonly policy = new PolicyEvaluator();

  private static readonly STATS_EVENT_TYPES = new Set<AgentSessionEvent['type']>([
    'agent_start',
    'turn_end',
    'message_end',
    'agent_settled',
    'compaction_end',
  ]);

  public async startTask(promptText: string, _modelId: string, webview: Webview, images?: string[], path?: string): Promise<void> {
    this.prepareRun(webview);
    const cwd = getWorkspaceCwd();

    try {
      const session = await this.getOrCreateSession(path, cwd);

      const isNewSession = session.agent.state.messages.length === 0;
      const envDetails = await getEnvironmentDetails(session, cwd, isNewSession);
      session.sessionManager.appendCustomMessageEntry('environment_details', envDetails, false);

      const attachments = parseImageAttachments(images);

      void session.prompt(promptText, { images: attachments }).catch((err) => {
        if (!this.isAttemptCompletionAborted) {
          this.messenger.postError(err);
        }
      });
    } catch (err) {
      this.messenger.postError(err);
    }
  }

  public async continueTask(path: string, webview: Webview): Promise<void> {
    this.prepareRun(webview);
    const cwd = getWorkspaceCwd();

    try {
      const session = await this.getOrCreateSession(path, cwd);

      const isNewSession = session.agent.state.messages.length === 0;
      const envDetails = await getEnvironmentDetails(session, cwd, isNewSession);

      void session
        .sendCustomMessage({ customType: 'environment_details', content: envDetails, display: false }, { triggerTurn: true })
        .catch((err) => {
          if (!this.isAttemptCompletionAborted) {
            this.messenger.postError(err);
          }
        });
    } catch (err) {
      this.messenger.postError(err);
    }
  }

  public approveTool(approvalId: string): void {
    const resolve = this.pendingApprovals.get(approvalId);
    if (resolve) {
      resolve({ block: false });
      this.pendingApprovals.delete(approvalId);
    }
  }

  public denyTool(approvalId: string): void {
    const resolve = this.pendingApprovals.get(approvalId);
    if (resolve) {
      resolve({ block: true, reason: 'Action denied by user.' });
      this.pendingApprovals.delete(approvalId);
    }
  }

  public abort(): void {
    if (this.session) {
      void this.session.abort().catch((err) => {
        console.error('Failed to abort session:', err);
      });
    }
  }

  public dispose(): void {
    this.messenger.dispose();
    this.cleanupSession();
    this.pendingApprovals.clear();
  }

  public getSessionFile(): string | undefined {
    return this.session?.sessionFile;
  }

  private prepareRun(webview: Webview): void {
    this.messenger.attach(webview);
    this.pendingApprovals.clear();
    this.isAttemptCompletionAborted = false;
    this.event.resetTurnState();
  }

  private async getOrCreateSession(path: string | undefined, cwd: string): Promise<AgentSession> {
    if (this.session && path && this.session.sessionFile === path) {
      return this.session;
    }

    this.cleanupSession();

    const session = await SessionFactory.create(cwd, path);
    this.session = session;

    this.setupBeforeToolCallHook(session, cwd);
    this.subscribeToSessionEvents(session);

    return session;
  }

  private setupBeforeToolCallHook(session: AgentSession, cwd: string): void {
    session.agent.beforeToolCall = async ({ toolCall, args }) => {
      const toolName = toolCall.name as ToolName;
      const decision = await this.policy.evaluate(cwd, toolName, args);

      if (decision.action === 'approve') {
        return { block: false };
      }
      if (decision.action === 'deny') {
        return { block: true, reason: decision.reason };
      }

      const approvalId = `${toolCall.id || Date.now()}`;
      this.messenger.post({
        type: 'tool_approval_request',
        payload: {
          id: approvalId,
          tool_name: toolName,
          arguments: JSON.stringify(args),
        },
      });

      return new Promise<BeforeToolCallResult>((resolve) => {
        this.pendingApprovals.set(approvalId, resolve);
      });
    };
  }

  private subscribeToSessionEvents(session: AgentSession): void {
    this.unsubscribeSessionEvents = session.subscribe((event) => {
      this.handleSessionEvent(event, session);
    });
  }

  private handleSessionEvent(event: AgentSessionEvent, session: AgentSession): void {
    if (this.isAttemptCompletionAborted && event.type === 'message_end' && event.message.role === 'assistant') {
      (event as any).type = 'ignored';
      const messages = session.agent.state.messages;
      if (messages && messages[messages.length - 1] === event.message) {
        messages.pop();
      }
    }

    const message = this.event.mapEvent(event, session, this.isAttemptCompletionAborted);
    if (message) {
      this.messenger.post(message);
    }

    if (event.type === 'tool_execution_end' && event.toolName === 'attempt_completion') {
      this.isAttemptCompletionAborted = true;
      this.abort();
      finalizeAttemptCompletion(session);
    }

    if (AgentRunner.STATS_EVENT_TYPES.has(event.type)) {
      const statsMsg = this.event.createStatsMessage(session);
      if (statsMsg) {
        this.messenger.post(statsMsg);
      }
    }
  }

  private cleanupSession(): void {
    if (this.unsubscribeSessionEvents) {
      try {
        this.unsubscribeSessionEvents();
      } catch (err) {
        console.error('Failed to unsubscribe session events during cleanup:', err);
      }
      this.unsubscribeSessionEvents = null;
    }

    if (this.session) {
      try {
        this.session.dispose();
      } catch (err) {
        console.error('Failed to dispose session during cleanup:', err);
      }
      this.session = null;
    }
  }
}

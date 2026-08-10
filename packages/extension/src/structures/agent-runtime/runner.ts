import { EventMapper } from '@pi-code/extension/structures/agent-runtime/event';
import { evaluateToolApproval } from '@pi-code/extension/structures/agent-runtime/policy';
import { QuestionBridge } from '@pi-code/extension/structures/agent-runtime/question';
import { createSession } from '@pi-code/extension/structures/agent-runtime/session';
import { WebviewMessenger } from '@pi-code/extension/structures/agent-runtime/webview';
import { listCommands } from '@pi-code/extension/structures/chat-command/command';
import { getEnvironmentDetails } from '@pi-code/extension/structures/chat-session/environment';
import { parseBase64DataUrl } from '@pi-code/extension/utilities/codec';
import { getWorkspaceCwd } from '@pi-code/extension/utilities/vscode';
import { logger } from '@pi-code/shared/core/logger';

import type { BeforeToolCallResult } from '@earendil-works/pi-agent-core';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';
import type { ModelItem, ToolName } from '@pi-code/shared/core/protocol';

export type ToolApprovalDecision = { action: 'approve' } | { action: 'deny'; reason: string } | { action: 'confirm' };

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
  private pendingApprovals = new Map<string, (res: BeforeToolCallResult) => void>();
  private isAttemptCompletionAborted = false;
  private unsubscribeSessionEvents: (() => void) | null = null;

  private readonly messenger = new WebviewMessenger();
  private readonly event = new EventMapper();
  private readonly question = QuestionBridge.getInstance();

  public async startTask(
    promptText: string,
    selectedModel: Pick<ModelItem, 'id' | 'provider'> | undefined,
    webview: Webview,
    images?: string[],
    path?: string,
  ): Promise<void> {
    try {
      const { session, envDetails } = await this.prepareSession(webview, path, selectedModel);
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

  public async continueTask(path: string, webview: Webview, selectedModel?: Pick<ModelItem, 'id' | 'provider'>): Promise<void> {
    try {
      const { session, envDetails } = await this.prepareSession(webview, path, selectedModel);

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

    if (this.session) {
      void this.session.abort().catch((err) => {
        logger.error('Failed to abort session:', err);
      });
    }
  }

  public dispose(): void {
    this.messenger.dispose();
    this.cleanupSession();
    this.pendingApprovals.clear();
    this.question.cancelAll();
  }

  public getSessionFile(): string | undefined {
    return this.session?.sessionFile;
  }

  private prepareRun(webview: Webview): void {
    this.messenger.attach(webview);
    this.pendingApprovals.clear();
    this.question.cancelAll();
    this.isAttemptCompletionAborted = false;
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

    this.setupBeforeToolCallHook(session, cwd);
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

  private setupBeforeToolCallHook(session: AgentSession, cwd: string): void {
    session.agent.beforeToolCall = async ({ toolCall, args }) => {
      const toolName = toolCall.name as ToolName;
      const decision = await evaluateToolApproval(cwd, toolName, args);

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
      const messages = session.agent.state.messages;
      if (messages && messages[messages.length - 1] === event.message) {
        messages.pop();
      }
    }

    const message = this.event.mapEvent(event, session, this.isAttemptCompletionAborted);
    if (message) {
      this.messenger.post(message);
    }

    // `attempt_completion` ends the turn by contract, so stop the agent loop
    // rather than letting it request another completion.
    if (event.type === 'tool_execution_end' && event.toolName === 'attempt_completion') {
      this.isAttemptCompletionAborted = true;
      this.abort();
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

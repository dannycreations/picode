import { AgentSession, createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { workspace } from 'vscode';

import { SettingsService } from '@extension/core/settings';
import { getEnvironmentDetails } from '@extension/structures/chat-session/environment';
import { askQuestionTool } from '@extension/structures/tool-call/ask-question';
import { attemptCompletionTool } from '@extension/structures/tool-call/attempt-completion';
import { deleteFileTool } from '@extension/structures/tool-call/delete-file';
import { editFileTool } from '@extension/structures/tool-call/edit-file';
import { executeCommandTool } from '@extension/structures/tool-call/execute-command';
import { readFileTool } from '@extension/structures/tool-call/read-file';
import { updateTodoTool } from '@extension/structures/tool-call/update-todo';
import { writeFileTool } from '@extension/structures/tool-call/write-file';
import { resolvePathAction } from '@extension/utilities/path';

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';
import type { AssistantMessageWithUsage } from '@extension/types/extension';
import type { ExtensionToWebviewMessage, ToolName } from '@extension/types/webview';

export interface BeforeToolCallResult {
  readonly block?: boolean;
  readonly reason?: string;
}

export class AgentRunner {
  private session: AgentSession | null = null;
  private pendingApprovals = new Map<string, (res: BeforeToolCallResult) => void>();
  private currentApiRequestId: string | null = null;

  private postWebviewMessage(webview: Webview, message: ExtensionToWebviewMessage): void {
    void webview.postMessage(message);
  }

  public async startTask(promptText: string, _modelId: string, webview: Webview, images?: string[], path?: string): Promise<void> {
    this.pendingApprovals.clear();

    const workspaceFolders = workspace.workspaceFolders;
    const cwd = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : process.cwd();

    try {
      const session = await this.getOrCreateSession(path, webview, cwd);

      // Start prompt on the session (re-used or newly created)
      const includeFileDetails = session.agent.state.messages.length === 0;
      const envDetails = await getEnvironmentDetails(session, cwd, includeFileDetails);
      session.sessionManager.appendCustomMessageEntry('environment_details', envDetails, false);
      const finalPromptText = promptText;

      const attachmentImages = images
        ? images
            .map((img) => {
              const match = img.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                return {
                  type: 'image' as const,
                  mimeType: match[1],
                  data: match[2],
                };
              }
              return null;
            })
            .filter((x): x is { type: 'image'; mimeType: string; data: string } => x !== null)
        : undefined;

      void session.prompt(finalPromptText, { images: attachmentImages }).catch((err) => {
        this.postWebviewMessage(webview, {
          type: 'agent_error',
          payload: {
            message: err instanceof Error ? err.message : String(err),
          },
        });
      });
    } catch (err) {
      this.postWebviewMessage(webview, {
        type: 'agent_error',
        payload: {
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  public async continueTask(path: string, webview: Webview): Promise<void> {
    this.pendingApprovals.clear();

    const workspaceFolders = workspace.workspaceFolders;
    const cwd = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : process.cwd();

    try {
      const session = await this.getOrCreateSession(path, webview, cwd);

      // Start prompt on the session (re-used or newly created)
      const includeFileDetails = session.agent.state.messages.length === 0;
      const envDetails = await getEnvironmentDetails(session, cwd, includeFileDetails);

      void session
        .sendCustomMessage(
          {
            customType: 'environment_details',
            content: envDetails,
            display: false,
          },
          { triggerTurn: true },
        )
        .catch((err) => {
          this.postWebviewMessage(webview, {
            type: 'agent_error',
            payload: {
              message: err instanceof Error ? err.message : String(err),
            },
          });
        });
    } catch (err) {
      this.postWebviewMessage(webview, {
        type: 'agent_error',
        payload: {
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  private async getOrCreateSession(path: string | undefined, webview: Webview, cwd: string): Promise<AgentSession> {
    if (this.session && (!path || this.session.sessionFile === path)) {
      return this.session;
    }

    if (this.session) {
      this.session.dispose();
      this.session = null;
    }

    let sessionManagerOption: SessionManager | undefined = undefined;
    if (path) {
      sessionManagerOption = SessionManager.open(path);
    }

    const { session } = await createAgentSession({
      cwd,
      sessionManager: sessionManagerOption,
      tools: [
        'delete_file',
        'edit_file',
        'read_file',
        'write_file',
        'execute_command',
        'ask_question',
        'attempt_completion',
        'update_todo',
      ] as ToolName[],
      customTools: [
        deleteFileTool,
        editFileTool,
        readFileTool,
        writeFileTool,
        executeCommandTool,
        askQuestionTool,
        attemptCompletionTool,
        updateTodoTool,
      ],
      // Let it auto-resolve model and credentials
    });

    this.session = session;

    // Setup the tool approval hook
    this.session.agent.beforeToolCall = async ({ toolCall, args }) => {
      const toolName = toolCall.name as ToolName;
      if (toolName === 'attempt_completion') {
        return { block: false };
      }

      try {
        const settings = await SettingsService.getInstance(cwd).load();

        if (toolName === 'read_file') {
          const files = (args as { files?: { path: string }[] }).files || [];
          const allowedRead = (settings.allowedReadPaths || []) as string[];
          const deniedRead = (settings.deniedReadPaths || []) as string[];
          const resolutions = files.map((f) => resolvePathAction(f.path, settings.autoApproveRead, allowedRead, deniedRead));

          if (resolutions.includes('deny')) {
            return {
              block: true,
              reason: 'Access to read one or more of the specified paths is explicitly denied by settings.',
            };
          }
          if (resolutions.every((r) => r === 'approve')) {
            return { block: false };
          }
        } else if (toolName === 'write_file' || toolName === 'edit_file') {
          const filePath = (args as { path?: string }).path || '';
          const allowedWrite = (settings.allowedWritePaths || []) as string[];
          const deniedWrite = (settings.deniedWritePaths || []) as string[];
          const resolution = resolvePathAction(filePath, settings.autoApproveWrite, allowedWrite, deniedWrite);

          if (resolution === 'deny') {
            return {
              block: true,
              reason: 'Access to write/edit this file path is explicitly denied by settings.',
            };
          }
          if (resolution === 'approve') {
            return { block: false };
          }
        } else if (toolName === 'delete_file' && settings.autoApproveDelete) {
          return { block: false };
        } else if (toolName === 'execute_command' && settings.autoApproveExecute) {
          return { block: false };
        }
      } catch (err) {
        console.error('Failed to load settings for auto-approval:', err);
      }

      const approvalId = `${toolCall.id || Date.now()}`;

      this.postWebviewMessage(webview, {
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

    // Subscribe to agent events and stream to webview
    this.session.subscribe((event) => {
      const message = this.mapAgentEvent(event, this.session!);
      if (message) {
        this.postWebviewMessage(webview, message);
      }

      if (
        event.type === 'agent_start' ||
        event.type === 'turn_end' ||
        event.type === 'message_end' ||
        event.type === 'agent_settled' ||
        event.type === 'compaction_end'
      ) {
        try {
          const stats = this.session!.getSessionStats();
          this.postWebviewMessage(webview, {
            type: 'stats_update',
            payload: {
              tokensIn: stats.tokens.input,
              tokensOut: stats.tokens.output,
              cacheReads: stats.tokens.cacheRead,
              cacheWrites: stats.tokens.cacheWrite,
              totalCost: stats.cost,
              contextTokens: stats.contextUsage?.tokens ?? 0,
              contextLimit: stats.contextUsage?.contextWindow ?? this.session!.model?.contextWindow ?? 200000,
            },
          });
        } catch (err) {
          console.error('Failed to post session stats:', err);
        }
      }
    });

    return this.session;
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
      void this.session.abort();
    }
  }

  public dispose(): void {
    if (this.session) {
      this.session.dispose();
      this.session = null;
    }
    this.pendingApprovals.clear();
  }

  public getSessionFile(): string | undefined {
    return this.session?.sessionFile;
  }

  private mapAgentEvent(event: AgentSessionEvent, session: AgentSession): ExtensionToWebviewMessage | null {
    switch (event.type) {
      case 'agent_start':
        return {
          type: 'agent_start',
          payload: {
            path: session.sessionFile,
          },
        };

      case 'turn_start': {
        this.currentApiRequestId = `api-req-${Date.now()}`;
        return {
          type: 'api_request_start',
          payload: {
            id: this.currentApiRequestId,
            timestamp: Date.now(),
          },
        };
      }

      case 'turn_end': {
        const id = this.currentApiRequestId || `api-req-${Date.now()}`;
        this.currentApiRequestId = null;
        const cost = event.message?.role === 'assistant' ? (event.message as AssistantMessageWithUsage).usage?.cost?.total : undefined;
        const error = event.message?.role === 'assistant' && event.message.stopReason === 'error' ? event.message.errorMessage : undefined;
        return {
          type: 'api_request_end',
          payload: {
            id,
            cost,
            error,
          },
        };
      }

      case 'message_start':
        if (event.message.role !== 'user' && event.message.role !== 'assistant') {
          return null;
        }
        return {
          type: 'message_start',
          payload: {
            role: event.message.role,
            timestamp: event.message.timestamp,
          },
        };

      case 'message_update':
        if (event.assistantMessageEvent.type === 'text_delta') {
          return {
            type: 'text_delta',
            payload: {
              delta: event.assistantMessageEvent.delta,
            },
          };
        } else if (event.assistantMessageEvent.type === 'thinking_delta') {
          return {
            type: 'thinking_delta',
            payload: {
              delta: event.assistantMessageEvent.delta,
            },
          };
        }
        return null;

      case 'message_end':
        if (event.message.role !== 'user' && event.message.role !== 'assistant') {
          return null;
        }
        return {
          type: 'message_end',
          payload: {
            role: event.message.role,
            cost: event.message.role === 'assistant' ? (event.message as AssistantMessageWithUsage).usage?.cost?.total : undefined,
          },
        };

      case 'tool_execution_start':
        return {
          type: 'tool_execution_start',
          payload: {
            id: event.toolCallId,
            tool_name: event.toolName as ToolName,
            arguments: JSON.stringify(event.args),
          },
        };

      case 'tool_execution_end':
        return {
          type: 'tool_execution_end',
          payload: {
            id: event.toolCallId,
            result: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
            is_error: event.isError,
          },
        };

      case 'agent_settled':
        return { type: 'agent_settled' };

      default:
        return null;
    }
  }
}

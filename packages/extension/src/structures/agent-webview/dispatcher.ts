import { formatThrownValue } from '@earendil-works/pi-ai';
import { window } from 'vscode';

import { SettingsService } from '@pi-code/extension/core/settings';
import { runCompact } from '@pi-code/extension/structures/chat-command/builtin';
import { logger } from '@pi-code/shared/core/logger';

import type { MessageHandlerContext } from '@pi-code/extension/structures/agent-webview/types';
import type { ModelItem, WebviewToExtensionMessage } from '@pi-code/shared/core/protocol';

type CommandHandler<T extends WebviewToExtensionMessage['type']> = (
  message: Extract<WebviewToExtensionMessage, { type: T }>,
  context: MessageHandlerContext,
) => unknown;

type HandlerMap = {
  [T in WebviewToExtensionMessage['type']]: CommandHandler<T>;
};

interface ChatMessageDispatcher {
  readonly dispatch: (message: WebviewToExtensionMessage, context: MessageHandlerContext) => Promise<void>;
}

type ModelSelection = Pick<ModelItem, 'id' | 'provider'>;

function toModelSelection(msg: { model_id?: string; model_provider?: string }): ModelSelection | undefined {
  return msg.model_provider && msg.model_id ? { id: msg.model_id, provider: msg.model_provider } : undefined;
}

const HANDLER_MAP: HandlerMap = {
  init: async (_, ctx) => {
    const data = await ctx.sessionService.getInitData(ctx.cwd);
    ctx.postMessage({ type: 'init_data', payload: data });
  },
  start_new_task: (msg, ctx) => {
    void ctx.agent.startTask(msg.text, toModelSelection(msg), ctx.webview, msg.images);
  },
  send_message: (msg, ctx) => {
    void ctx.agent.startTask(msg.text, toModelSelection(msg), ctx.webview, msg.images, msg.path);
  },
  continue_task: (msg, ctx) => {
    void ctx.agent.continueTask(msg.path || '', ctx.webview, toModelSelection(msg));
  },
  approve_tool: (msg, ctx) => ctx.agent.approveTool(msg.approval_id),
  deny_tool: (msg, ctx) => ctx.agent.denyTool(msg.approval_id),
  question_response: (msg, ctx) => ctx.agent.answerQuestion(msg.question_id, msg.text),
  cancel_task: (_, ctx) => ctx.agent.abort(),
  reload: (_, ctx) => {
    void ctx.agent.reload(ctx.webview);
  },
  compact: async (msg, ctx) => {
    const path = msg.path || ctx.agent.getSessionFile();
    await runCompact(ctx, msg.id, msg.title, path);
  },
  close_task: (_, ctx) => {
    try {
      ctx.agent.dispose();
    } catch (err) {
      logger.error('Failed to dispose agent runner:', err);
    }
    ctx.recreateAgent();
  },
  load_session: async (msg, ctx) => {
    const { messages, stats } = await ctx.sessionService.loadSessionDetails(msg.path, ctx.cwd);
    ctx.postMessage({
      type: 'session_loaded',
      payload: { id: msg.id, title: msg.title, messages, path: msg.path, ...stats },
    });
  },
  view_raw_task: async (msg, ctx) => {
    const path = msg.path || ctx.agent.getSessionFile();
    await ctx.workspaceService.openRawTask(path);
  },
  export_session: async (msg, ctx) => {
    const exported = await ctx.sessionService.exportSession(msg.path, msg.id);
    if (exported) window.showInformationMessage('Task exported successfully!');
  },
  open_file: async (msg, ctx) => {
    await ctx.workspaceService.openFile(ctx.cwd, msg.text, msg.values?.line);
  },
  open_image: async (msg, ctx) => {
    await ctx.workspaceService.openBase64Image(msg.dataUrl);
  },
  get_history: async (msg, ctx) => {
    const history = await ctx.sessionService.fetchHistory(ctx.cwd, msg.scope);
    ctx.postMessage({ type: 'history_data', payload: { history } });
  },
  delete_sessions: async (msg, ctx) => {
    await ctx.sessionService.deleteSessions(msg.paths);
  },
  update_settings: async (msg, ctx) => {
    await SettingsService.getInstance(ctx.cwd).updateSettings(msg.settings);
  },
};

export function createDefaultDispatcher(): ChatMessageDispatcher {
  return {
    async dispatch(message, context) {
      const handler = HANDLER_MAP[message.type] as ChatMessageDispatcher['dispatch'];
      try {
        await handler(message, context);
      } catch (err) {
        const errorMessage = formatThrownValue(err);
        logger.error(`Error handling message "${message.type}":`, err);
        window.showErrorMessage(`Action failed (${message.type}): ${errorMessage}`);
      }
    },
  };
}

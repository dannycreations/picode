import { window } from 'vscode';

import { SettingsService } from '@pi-code/extension/core/settings';
import { runBuiltinCommand, runCompact } from '@pi-code/extension/structures/chat-command/builtin';
import { logger } from '@pi-code/shared/core/logger';
import { toErrorMessage } from '@pi-code/shared/utilities/common';

import type { MessageHandlerContext } from '@pi-code/extension/structures/agent-webview/types';
import type { ModelItem, WebviewToExtensionMessage } from '@pi-code/shared/core/protocol';

export type CommandHandler<T extends WebviewToExtensionMessage['type']> = (
  message: Extract<WebviewToExtensionMessage, { type: T }>,
  context: MessageHandlerContext,
) => Promise<void> | void;

export class ChatMessageDispatcher {
  private handlers = new Map<WebviewToExtensionMessage['type'], CommandHandler<WebviewToExtensionMessage['type']>>();

  public register<T extends WebviewToExtensionMessage['type']>(type: T, handler: CommandHandler<T>): this {
    this.handlers.set(type, handler as unknown as CommandHandler<WebviewToExtensionMessage['type']>);
    return this;
  }

  public async dispatch(message: WebviewToExtensionMessage, context: MessageHandlerContext): Promise<void> {
    const handler = this.handlers.get(message.type);
    if (!handler) return;

    try {
      await handler(message, context);
    } catch (err) {
      const errorMessage = toErrorMessage(err);
      logger.error(`Error handling message "${message.type}":`, err);
      window.showErrorMessage(`Action failed (${message.type}): ${errorMessage}`);
    }
  }
}

type ModelSelection = Pick<ModelItem, 'id' | 'provider'>;

function toModelSelection(msg: { model_id?: string; model_provider?: string }): ModelSelection | undefined {
  return msg.model_provider && msg.model_id ? { id: msg.model_id, provider: msg.model_provider } : undefined;
}

export function createDefaultDispatcher(): ChatMessageDispatcher {
  return new ChatMessageDispatcher()
    .register('init', async (_, ctx) => {
      const data = await ctx.sessionService.getInitData(ctx.cwd);
      ctx.postMessage({ type: 'init_data', payload: data });
    })
    .register('start_new_task', (msg, ctx) => {
      if (runBuiltinCommand(ctx, msg.text, undefined)) return;

      void ctx.agent.startTask(msg.text, toModelSelection(msg), ctx.webview, msg.images);
    })
    .register('send_message', (msg, ctx) => {
      if (runBuiltinCommand(ctx, msg.text, msg.path)) return;

      void ctx.agent.startTask(msg.text, toModelSelection(msg), ctx.webview, msg.images, msg.path);
    })
    .register('continue_task', (msg, ctx) => {
      void ctx.agent.continueTask(msg.path || '', ctx.webview, toModelSelection(msg));
    })
    .register('approve_tool', (msg, ctx) => ctx.agent.approveTool(msg.approval_id))
    .register('deny_tool', (msg, ctx) => ctx.agent.denyTool(msg.approval_id))
    .register('question_response', (msg, ctx) => ctx.agent.answerQuestion(msg.question_id, msg.text))
    .register('cancel_task', (_, ctx) => ctx.agent.abort())
    .register('reload', (_, ctx) => {
      void ctx.agent.reload(ctx.webview);
    })
    .register('compact', async (msg, ctx) => {
      const path = msg.path || ctx.agent.getSessionFile();
      await runCompact(ctx, msg.id, msg.title, path);
    })
    .register('close_task', (_, ctx) => {
      try {
        ctx.agent.dispose();
      } catch (err) {
        logger.error('Failed to dispose agent runner:', err);
      }
      ctx.recreateAgent();
    })
    .register('load_session', async (msg, ctx) => {
      const { messages, stats } = await ctx.sessionService.loadSessionDetails(msg.path, ctx.cwd);
      ctx.postMessage({
        type: 'session_loaded',
        payload: { id: msg.id, title: msg.title, messages, path: msg.path, ...stats },
      });
    })
    .register('view_raw_task', async (msg, ctx) => {
      const path = msg.path || ctx.agent.getSessionFile();
      await ctx.workspaceService.openRawTask(path);
    })
    .register('export_session', async (msg, ctx) => {
      const exported = await ctx.sessionService.exportSession(msg.path, msg.id);
      if (exported) window.showInformationMessage('Task exported successfully!');
    })
    .register('open_file', async (msg, ctx) => {
      await ctx.workspaceService.openFile(ctx.cwd, msg.text, msg.values?.line);
    })
    .register('open_image', async (msg, ctx) => {
      await ctx.workspaceService.openBase64Image(msg.dataUrl);
    })
    .register('get_history', async (msg, ctx) => {
      const scope = msg.scope || 'current';
      const history = await ctx.sessionService.fetchHistory(ctx.cwd, scope);
      ctx.postMessage({ type: 'history_data', payload: { history } });
    })
    .register('delete_sessions', async (msg, ctx) => {
      await ctx.sessionService.deleteSessions(msg.paths);
    })
    .register('update_settings', async (msg, ctx) => {
      const settings = await SettingsService.getInstance(ctx.cwd).updateSettings(msg.settings);
      ctx.postMessage({ type: 'settings_data', payload: { settings } });
    });
}

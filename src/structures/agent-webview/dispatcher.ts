import { window } from 'vscode';

import { SettingsService } from '@extension/core/settings';
import { AgentRunner } from '@extension/structures/agent-runtime/runner';

import type { Webview } from 'vscode';
import type { SessionInitData, SessionService } from '@extension/structures/agent-webview/session';
import type { WorkspaceService } from '@extension/structures/agent-webview/workspace';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@extension/types/webview';

export type MessageHandlerContext = {
  readonly cwd: string;
  readonly webview: Webview;
  readonly agent: AgentRunner;
  readonly recreateAgent: () => AgentRunner;
  readonly postMessage: (msg: ExtensionToWebviewMessage) => void;
  readonly cachedInitData: Record<string, SessionInitData>;
  readonly sessionService: SessionService;
  readonly workspaceService: WorkspaceService;
};

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
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Error handling message "${message.type}":`, err);
      window.showErrorMessage(`Action failed (${message.type}): ${errorMessage}`);
    }
  }
}

export function createDefaultDispatcher(): ChatMessageDispatcher {
  return new ChatMessageDispatcher()
    .register('init', async (_, ctx) => {
      if (ctx.cachedInitData[ctx.cwd]) {
        ctx.postMessage({ type: 'init_data', payload: ctx.cachedInitData[ctx.cwd] });
      }
      const data = await ctx.sessionService.getInitData(ctx.cwd);
      ctx.cachedInitData[ctx.cwd] = data;
      ctx.postMessage({ type: 'init_data', payload: data });
    })
    .register('start_new_task', (msg, ctx) => {
      const model = msg.model_provider && msg.model_id ? { id: msg.model_id, provider: msg.model_provider } : undefined;
      void ctx.agent.startTask(msg.text, model, ctx.webview, msg.images);
    })
    .register('send_message', (msg, ctx) => {
      const model = msg.model_provider && msg.model_id ? { id: msg.model_id, provider: msg.model_provider } : undefined;
      void ctx.agent.startTask(msg.text, model, ctx.webview, msg.images, msg.path);
    })
    .register('continue_task', (msg, ctx) => {
      const model = msg.model_provider && msg.model_id ? { id: msg.model_id, provider: msg.model_provider } : undefined;
      void ctx.agent.continueTask(msg.path || '', ctx.webview, model);
    })
    .register('approve_tool', (msg, ctx) => ctx.agent.approveTool(msg.approval_id))
    .register('deny_tool', (msg, ctx) => ctx.agent.denyTool(msg.approval_id))
    .register('question_response', (msg, ctx) => ctx.agent.answerQuestion(msg.question_id, msg.text))
    .register('cancel_task', (_, ctx) => ctx.agent.abort())
    .register('close_task', (_, ctx) => {
      try {
        ctx.agent.dispose();
      } catch (err) {
        console.error('Failed to dispose agent runner:', err);
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
      if (scope !== 'all') {
        ctx.cachedInitData[ctx.cwd] = { ...ctx.cachedInitData[ctx.cwd], history };
      }
      ctx.postMessage({ type: 'history_data', payload: { history } });
    })
    .register('delete_sessions', async (msg, ctx) => {
      const scope = msg.scope || 'current';
      const history = await ctx.sessionService.deleteSessions(msg.paths, scope, ctx.cwd);
      if (scope !== 'all') {
        ctx.cachedInitData[ctx.cwd] = { ...ctx.cachedInitData[ctx.cwd], history };
      }
      ctx.postMessage({ type: 'history_data', payload: { history } });
    })
    .register('get_settings', async (_, ctx) => {
      const settings = await SettingsService.getInstance(ctx.cwd).load();
      ctx.postMessage({ type: 'settings_data', payload: { settings } });
    })
    .register('update_setting', async (msg, ctx) => {
      const settings = await SettingsService.getInstance(ctx.cwd).update(msg.key, msg.value);
      ctx.postMessage({ type: 'settings_data', payload: { settings } });
    });
}

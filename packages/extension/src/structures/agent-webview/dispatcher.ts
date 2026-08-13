import { formatThrownValue } from '@earendil-works/pi-ai';
import { window } from 'vscode';

import { writeAppSettings } from '@pi-code/extension/core/settings';
import { approveApproval, denyApproval } from '@pi-code/extension/structures/agent-runtime/brokers/policy';
import { answerQuestion } from '@pi-code/extension/structures/agent-runtime/brokers/question';
import { deleteSessions, exportSession, fetchHistory, getInitData, loadSessionDetails } from '@pi-code/extension/structures/agent-webview/session';
import { ACTIVE_TASK_ID, HISTORY_SCOPES } from '@pi-code/shared/core/constants';
import { logger } from '@pi-code/shared/core/logger';

import type { MessageHandlerContext } from '@pi-code/extension/structures/agent-webview/types';
import type { HistoryScope, WebviewToExtensionMessage } from '@pi-code/shared/core/protocol';
import type { ChatMessage, StatsData } from '@pi-code/shared/core/types';

type CommandHandler<T extends WebviewToExtensionMessage['type']> = (
  message: Extract<WebviewToExtensionMessage, { type: T }>,
  context: MessageHandlerContext,
) => unknown;

type HandlerMap = {
  [T in WebviewToExtensionMessage['type']]: CommandHandler<T>;
};

interface TranscriptDetails {
  readonly messages: ChatMessage[];
  readonly stats: StatsData;
}

async function postSession(
  ctx: MessageHandlerContext,
  id: string,
  title: string,
  path: string | undefined,
  details: TranscriptDetails,
): Promise<void> {
  ctx.postMessage({
    type: 'session_loaded',
    payload: { id: id || ACTIVE_TASK_ID, title: title || '', messages: details.messages, path, ...details.stats },
  });
}

async function postHistory(ctx: MessageHandlerContext, scope: HistoryScope): Promise<void> {
  const history = await fetchHistory(ctx.cwd, scope);
  ctx.postMessage({ type: 'history_data', payload: { history, scope } });
}

const HANDLER_MAP: HandlerMap = {
  init: async (_, ctx) => {
    const data = await getInitData(ctx.cwd);
    ctx.postMessage({ type: 'init_data', payload: data });
  },
  send_message: (msg, ctx) => {
    void ctx.agent.startTask(msg.text, msg.model, msg.images, msg.path);
  },
  add_to_reply_queue: (msg, ctx) => {
    ctx.agent.addToReplyQueue(msg.text, msg.images);
  },
  edit_reply_queue: (msg, ctx) => {
    ctx.agent.editReplyQueue(msg.id, msg.text);
  },
  remove_from_reply_queue: (msg, ctx) => {
    ctx.agent.removeFromReplyQueue(msg.id);
  },
  continue_task: (msg, ctx) => {
    void ctx.agent.continueTask(msg.path || '', msg.model);
  },
  tool_response: (msg) => {
    if (msg.approved) approveApproval(msg.approval_id);
    else denyApproval(msg.approval_id);
  },
  question_response: (msg) => answerQuestion(msg.question_id, msg.text),
  cancel_task: (_, ctx) => ctx.agent.cancelTask(),
  reload: (_, ctx) => {
    void ctx.agent.reload();
  },
  compact: async (msg, ctx) => {
    const path = msg.path || ctx.agent.getSessionFile();
    if (!path) {
      ctx.postMessage({ type: 'info', payload: { text: 'Open or start a task before using /compact.' } });
      return;
    }

    const details = await ctx.agent.compact(path);
    if (!details) return;

    // Refresh the webview from the in-memory session we just compacted instead
    // of re-opening and re-parsing the same session file a second time.
    await postSession(ctx, msg.id || ACTIVE_TASK_ID, msg.title || '', path, details);
  },
  close_task: async (_, ctx) => {
    ctx.agent.reset();

    // The just-closed task is now persisted on disk but the webview's Recent
    // Tasks list is still showing the stale init snapshot. Push the refreshed
    // current-scope history so the completed task renders without the user
    // first having to open the full History view.
    await postHistory(ctx, HISTORY_SCOPES[0]);
  },
  load_session: async (msg, ctx) => {
    const details = await loadSessionDetails(msg.path ?? '', ctx.cwd);
    await postSession(ctx, msg.id, msg.title, msg.path, details);
  },
  view_raw_task: async (msg, ctx) => {
    const path = msg.path || ctx.agent.getSessionFile();
    await ctx.workspace.openRawTask(path);
  },
  export_session: async (msg) => {
    const exported = await exportSession(msg.path, msg.id);
    if (exported) window.showInformationMessage('Task exported successfully!');
  },
  open_file: async (msg, ctx) => {
    if (msg.values?.diff) {
      await ctx.workspace.openFileInChanges(ctx.cwd, msg.text, msg.values?.line);
    } else {
      await ctx.workspace.openFile(ctx.cwd, msg.text, msg.values?.line);
    }
  },
  open_image: async (msg, ctx) => {
    await ctx.workspace.openBase64Image(msg.dataUrl);
  },
  save_image: async (msg, ctx) => {
    await ctx.workspace.saveImage(msg.dataUrl, msg.filename);
  },
  get_history: async (msg, ctx) => {
    await postHistory(ctx, msg.scope);
  },
  delete_sessions: async (msg) => {
    await deleteSessions(msg.paths);
  },
  update_settings: async (msg) => {
    // The write triggers `onDidChangeConfiguration`, which pushes the fresh
    // settings back to the webview; no need to read them back here.
    await writeAppSettings(msg.settings);
  },
  set_thinking_level: (msg, ctx) => {
    ctx.agent.setThinkingLevel(msg.level);
  },
};

export async function dispatch(message: WebviewToExtensionMessage, context: MessageHandlerContext): Promise<void> {
  try {
    const handler = HANDLER_MAP[message.type] as CommandHandler<typeof message.type>;
    await handler(message, context);
  } catch (err) {
    const errorMessage = formatThrownValue(err);
    logger.error(`Error handling message "${message.type}":`, err);
    window.showErrorMessage(`Action failed (${message.type}): ${errorMessage}`);
  }
}

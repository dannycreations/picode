import { formatThrownValue } from '@earendil-works/pi-ai';
import { window } from 'vscode';

import { writeAppSettings } from '@pi-code/extension/core/settings';
import { approveApproval, denyApproval } from '@pi-code/extension/structures/agent-runtime/brokers/approval';
import { answerQuestion } from '@pi-code/extension/structures/agent-runtime/brokers/question';
import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import {
  archiveSession,
  deleteSessions,
  exportSession,
  getInitData,
  isArchivedPath,
  loadSessionDetails,
  refreshModelCatalog,
  streamHistory,
} from '@pi-code/extension/structures/agent-webview/session';
import { toMentionText } from '@pi-code/extension/structures/chat-command/mention';
import { searchWorkspaceFiles } from '@pi-code/extension/utilities/fs';
import { ACTIVE_TASK_ID } from '@pi-code/shared/core/constants';
import { logger } from '@pi-code/shared/core/logger';
import { HISTORY_SCOPES } from '@pi-code/shared/core/protocol';

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

// Monotonic per-session counter for history refreshes. The webview applies
// only the highest epoch per scope, so a stale or out-of-order history_data
// chunk from an earlier refresh cannot corrupt the list.
let historyEpoch = 0;

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
  const isArchived = path ? isArchivedPath(path) : false;
  ctx.postMessage({
    type: 'session_loaded',
    payload: {
      id: id || ACTIVE_TASK_ID,
      title: title || '',
      messages: details.messages,
      path,
      isArchived,
      ...details.stats,
    },
  });
}

async function postHistory(ctx: MessageHandlerContext, scope: HistoryScope): Promise<void> {
  const epoch = ++historyEpoch;
  try {
    for await (const items of streamHistory(ctx.cwd, scope)) {
      ctx.postMessage({ type: 'history_data', payload: { scope, epoch, items } });
    }
  } catch (error) {
    logger.warn(`History stream for "${scope}" failed; the list may be incomplete.`, error);
  }
}

const HANDLER_MAP: HandlerMap = {
  init: async (_, ctx) => {
    historyEpoch = 0;

    const services = await createAgentResources(ctx.cwd);
    const data = await getInitData(ctx.cwd, services);
    // Send init_data before the history stream so the webview resets its epoch
    // bookkeeping before the first history_data chunk arrives.
    ctx.postMessage({ type: 'init_data', payload: data });
    void postHistory(ctx, 'current');
    // The local catalog is enough to render the chat view, so refresh the
    // remote catalog in the background and push the merged models once it lands.
    // Reuse the runtime we just built instead of re-resolving resources.
    void refreshModelCatalog(services.modelRuntime, (models) => {
      ctx.postMessage({ type: 'models_data', payload: { models } });
    });
  },
  send_message: (msg, ctx) => {
    void ctx.agent.startTask(msg.text, msg.images, msg.path);
  },
  search_files: async (msg, ctx) => {
    const paths = await searchWorkspaceFiles(msg.query, ctx.cwd);
    ctx.postMessage({ type: 'search_results', payload: { requestId: msg.requestId, paths } });
  },
  insert_mentions: (msg, ctx) => {
    const text = msg.paths
      .map((path) => path.trim())
      .filter((path) => path.length > 0)
      .map((path) => toMentionText(path, ctx.cwd))
      .join(' ');
    if (text.length === 0) return;
    ctx.postMessage({ type: 'set_chat_input', payload: { text: `${text} ` } });
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
    void ctx.agent.continueTask(msg.path || '');
  },
  tool_response: (msg) => {
    if (msg.approved) approveApproval(msg.approval_id);
    else denyApproval(msg.approval_id);
  },
  question_response: (msg) => answerQuestion(msg.question_id, msg.text),
  cancel_task: async (_, ctx) => {
    await ctx.agent.cancelTask();
    await postHistory(ctx, 'current');
  },
  builtin_command: async (msg, ctx) => {
    switch (msg.command) {
      case 'reload':
        void ctx.agent.reload();
        return;
      case 'update': {
        // Force a network refresh of the shared model runtime so both the webview
        // (via the pushed models_data) and the agent runtime read the newest catalog.
        window.showInformationMessage('Updating model catalog...');
        const services = await createAgentResources(ctx.cwd);
        void refreshModelCatalog(
          services.modelRuntime,
          (models) => {
            ctx.postMessage({ type: 'models_data', payload: { models } });
            window.showInformationMessage('Model catalog updated.');
          },
          true,
        );
        return;
      }
      case 'compact': {
        const path = msg.path || ctx.agent.getSessionFile();
        if (!path) {
          window.showInformationMessage('Open or start a task before using /compact.');
          return;
        }

        const details = await ctx.agent.compact(path);
        if (!details) return;

        // Refresh the webview from the in-memory session we just compacted instead
        // of re-opening and re-parsing the same session file a second time.
        await postSession(ctx, msg.id || ACTIVE_TASK_ID, msg.title || '', path, details);
        // Compaction rewrites the session file, so refresh the current sessions
        // list the way cancelTask does after it mutates the file on disk.
        await postHistory(ctx, 'current');
        return;
      }
    }
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
  archive_session: async (msg, ctx) => {
    const { path, archived } = await archiveSession(msg.path);
    ctx.postMessage({ type: 'archive_result', payload: { path, archived, id: msg.id, title: msg.title } });
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
  delete_sessions: async (msg, ctx) => {
    // Stop the running agent only when we are deleting the task it is on, so a
    // list deletion never cancels an unrelated active session.
    const activePath = ctx.agent.getSessionFile();
    if (activePath && msg.paths.includes(activePath)) {
      await ctx.agent.cancelTask();
    }
    await deleteSessions(msg.paths);
    // Re-stream every scope after the files are gone so the webview receives an
    // authoritative, post-delete snapshot in one awaited pass (no race with a
    // concurrent re-stream reading the disk before the delete finishes).
    for (const target of HISTORY_SCOPES) {
      await postHistory(ctx, target);
    }
  },
  update_settings: async (msg) => {
    // The write triggers `onDidChangeConfiguration`, which pushes the fresh
    // settings back to the webview; no need to read them back here.
    await writeAppSettings(msg.settings);
  },
  set_model: (msg, ctx) => {
    ctx.agent.applyModelAndThinking(msg.model, msg.thinkingLevel);
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

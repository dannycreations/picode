import { formatThrownValue } from '@earendil-works/pi-ai';
import { Uri, window, workspace } from 'vscode';

import { writeAppSettings } from '@pi-code/extension/core/settings';
import { approveApproval, denyApproval } from '@pi-code/extension/structures/agent-runtime/brokers/approval';
import { answerQuestion } from '@pi-code/extension/structures/agent-runtime/brokers/question';
import { persistModelAndThinking } from '@pi-code/extension/structures/agent-runtime/helpers/model-selection';
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
import { searchCommits } from '@pi-code/extension/structures/chat-command/helpers/git';
import { toMentionText } from '@pi-code/extension/structures/chat-command/mention';
import { searchWorkspaceFiles } from '@pi-code/extension/utilities/fs';
import { getWorkspaceCwd, setSelectedWorkspace } from '@pi-code/extension/utilities/vscode';
import { ACTIVE_TASK_ID } from '@pi-code/shared/core/constants';
import { logger } from '@pi-code/shared/core/logger';
import { HISTORY_SCOPES } from '@pi-code/shared/core/protocol';

import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { MessageHandlerContext } from '@pi-code/extension/structures/agent-webview/types';
import type { ExtensionToWebviewMessage, HistoryItem, HistoryScope, WebviewToExtensionMessage } from '@pi-code/shared/core/protocol';
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

function postSession(ctx: MessageHandlerContext, id: string, title: string, path: string | undefined, details: TranscriptDetails): void {
  const isArchived = path ? isArchivedPath(path) : false;
  ctx.runtime.postMessage({
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

async function postHistory(ctx: MessageHandlerContext, scope: HistoryScope, snapshot = false): Promise<void> {
  // Monotonic per-webview counter for history refreshes. The webview applies
  // only the highest epoch per scope, so a stale or out-of-order history_data
  // chunk from an earlier refresh cannot corrupt the list.
  const epoch = ++ctx.historyEpoch;
  const cwd = ctx.cwd;
  try {
    let items: HistoryItem[] | null = snapshot ? [] : null;
    for await (const chunk of streamHistory(cwd, scope)) {
      // A workspace switch mid-stream must not mix sessions across folders.
      if (ctx.cwd !== cwd) return;
      if (items) items.push(...chunk);
      else ctx.runtime.postMessage({ type: 'history_data', payload: { scope, epoch, items: chunk } });
    }
    if (items) ctx.runtime.postMessage({ type: 'history_data', payload: { scope, epoch, items } });
  } catch (error) {
    logger.warn(`History ${snapshot ? 'snapshot' : 'stream'} for "${scope}" failed; the list may be incomplete.`, error);
  }
}

function buildWorkspaceData(): Extract<ExtensionToWebviewMessage, { type: 'workspace_data' }>['payload'] {
  const folders = (workspace.workspaceFolders ?? []).map((folder) => ({ name: folder.name, path: folder.uri.fsPath }));
  return { folders, active: getWorkspaceCwd() };
}

// Refreshes the shared model runtime's catalog and pushes the merged list to
// the webview. `force` hits the network instead of trusting the cached catalog.
function pushModelCatalog(ctx: MessageHandlerContext, modelRuntime: ModelRuntime, force = false, onUpdated?: () => void): void {
  void refreshModelCatalog(modelRuntime, force).then((models) => {
    if (!models) return;
    ctx.runtime.postMessage({ type: 'models_data', payload: { models } });
    onUpdated?.();
  });
}

const HANDLER_MAP: HandlerMap = {
  init: async (_, ctx) => {
    const services = await createAgentResources(ctx.cwd);
    const data = await getInitData(ctx.cwd, services);
    ctx.runtime.postMessage({ type: 'init_data', payload: data });
    ctx.runtime.postMessage({ type: 'workspace_data', payload: buildWorkspaceData() });
    void postHistory(ctx, 'current');
    // The local catalog is enough to render the chat view, so refresh the
    // remote catalog in the background and push the merged models once it lands.
    // Reuse the runtime we just built instead of re-resolving resources.
    pushModelCatalog(ctx, services.modelRuntime);
  },
  send_message: (msg, ctx) => {
    void ctx.runtime.startTask(msg.text, msg.images, msg.path);
  },
  search_files: async (msg, ctx) => {
    const paths = await searchWorkspaceFiles(msg.query, ctx.cwd);
    ctx.runtime.postMessage({ type: 'search_results', payload: { requestId: msg.requestId, paths } });
  },
  search_commits: async (msg, ctx) => {
    const commits = await searchCommits(msg.query, ctx.cwd);
    ctx.runtime.postMessage({ type: 'commit_results', payload: { requestId: msg.requestId, commits } });
  },
  insert_mentions: (msg, ctx) => {
    const text = msg.paths
      .map((path) => path.trim())
      .filter((path) => path.length > 0)
      .map((path) => toMentionText(path, ctx.cwd))
      .join(' ');
    if (text.length === 0) return;
    ctx.runtime.postMessage({ type: 'set_chat_input', payload: { text: `${text} ` } });
  },
  add_to_reply_queue: (msg, ctx) => {
    ctx.runtime.replyQueue.add(msg.text, msg.images);
  },
  edit_reply_queue: (msg, ctx) => {
    ctx.runtime.replyQueue.edit(msg.id, msg.text);
  },
  remove_from_reply_queue: (msg, ctx) => {
    ctx.runtime.replyQueue.remove(msg.id);
  },
  continue_task: (msg, ctx) => {
    void ctx.runtime.continueTask(msg.path || '');
  },
  tool_response: (msg) => {
    if (msg.approved) approveApproval(msg.approval_id);
    else denyApproval(msg.approval_id);
  },
  question_response: (msg) => answerQuestion(msg.question_id, msg.text, msg.images),
  cancel_task: async (_, ctx) => {
    await ctx.runtime.cancelTask();
    await postHistory(ctx, 'current');
  },
  builtin_command: async (msg, ctx) => {
    switch (msg.command) {
      case 'reload': {
        const outcome = await ctx.runtime.reload();
        window.showInformationMessage(
          outcome === 'busy' ? 'Wait for the current task to finish before reloading.' : 'Reloaded skills, context files, and configuration.',
        );
        return;
      }
      case 'update': {
        // Force a network refresh of the shared model runtime so both the webview
        // (via the pushed models_data) and the agent runtime read the newest catalog.
        window.showInformationMessage('Updating model catalog...');
        const services = await createAgentResources(ctx.cwd);
        pushModelCatalog(ctx, services.modelRuntime, true, () => window.showInformationMessage('Model catalog updated.'));
        return;
      }
      case 'compact': {
        const path = msg.path || ctx.runtime.getSessionFile();
        if (!path) {
          window.showInformationMessage('Open or start a task before using /compact.');
          return;
        }

        const details = await ctx.runtime.compact(path);
        if (!details) return;

        // Refresh the webview from the in-memory session we just compacted instead
        // of re-opening and re-parsing the same session file a second time.
        postSession(ctx, msg.id || ACTIVE_TASK_ID, msg.title || '', path, details);
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
    const path = msg.path || ctx.runtime.getSessionFile();
    await ctx.workspace.openRawTask(path);
  },
  export_session: async (msg) => {
    const exported = await exportSession(msg.path, msg.id);
    if (exported) window.showInformationMessage('Task exported successfully!');
  },
  archive_session: async (msg, ctx) => {
    const { path, archived } = await archiveSession(msg.path);
    ctx.runtime.postMessage({ type: 'archive_result', payload: { path, archived, id: msg.id, title: msg.title } });
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
    const activePath = ctx.runtime.getSessionFile();
    if (activePath && msg.paths.includes(activePath)) {
      await ctx.runtime.cancelTask();
    }
    await deleteSessions(msg.paths);
    // Re-stream every scope after the files are gone so the webview receives an
    // authoritative, post-delete snapshot. Each scope is sent whole (not in
    // chunks) so the webview's list never transiently shrinks, which would drag
    // its pagination back a page.
    for (const target of HISTORY_SCOPES) {
      await postHistory(ctx, target, true);
    }
  },
  update_settings: async (msg) => {
    // The write triggers `onDidChangeConfiguration`, which pushes the fresh
    // settings back to the webview; no need to read them back here.
    await writeAppSettings(msg.settings);
  },
  set_model: (msg) => {
    persistModelAndThinking(msg.model, msg.thinkingLevel);
  },
  // Deliberately synchronous: the webview sends select_workspace immediately
  // followed by init, and init must observe the rewritten cwd.
  select_workspace: (msg, ctx) => {
    setSelectedWorkspace(Uri.file(msg.path));
    ctx.cwd = msg.path;
    ctx.runtime.postMessage({ type: 'workspace_data', payload: buildWorkspaceData() });
  },
};

export async function dispatch(message: WebviewToExtensionMessage, context: MessageHandlerContext): Promise<void> {
  logger.trace('Handling webview message:', message.type);
  try {
    const handler = HANDLER_MAP[message.type] as CommandHandler<typeof message.type>;
    await handler(message, context);
  } catch (err) {
    const errorMessage = formatThrownValue(err);
    logger.error(`Error handling message "${message.type}":`, err);
    window.showErrorMessage(`Action failed (${message.type}): ${errorMessage}`);
  }
}

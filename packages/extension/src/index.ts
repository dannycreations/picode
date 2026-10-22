import { cleanupSessionResources, registerSessionResourceCleanup } from '@earendil-works/pi-ai';
import { killTrackedDetachedChildren } from '@earendil-works/pi-coding-agent';
import { commands, languages, window, workspace } from 'vscode';

import { invalidateAppSettings, readAppSettings } from '@pi-code/extension/core/settings';
import { mcpGateway, setMcpClientVersion } from '@pi-code/extension/structures/agent-runtime/mcp/manager';
import { invalidateAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { ChatViewProvider } from '@pi-code/extension/structures/agent-webview/provider';
import { registerCommitMessageCommands } from '@pi-code/extension/structures/commit-message/command';
import { registerContextCommands } from '@pi-code/extension/structures/context-command/command';
import { PiCodeActionProvider } from '@pi-code/extension/structures/context-command/provider';
import { flushDebugLog, installFetchInterceptor } from '@pi-code/extension/utilities/interceptor';
import { getWorkspaceUri } from '@pi-code/extension/utilities/vscode';
import { COMMAND_IDS, DEFAULT_APP_ID } from '@pi-code/shared/core/constants';
import { logger } from '@pi-code/shared/core/logger';

import type { ExtensionContext } from 'vscode';

export function activate(context: ExtensionContext): void {
  setMcpClientVersion(context.extension.packageJSON.version);

  if (process.env['PI_CODE_DEBUG_HTTP']) {
    const workspaceUri = getWorkspaceUri();
    if (workspaceUri) {
      installFetchInterceptor(workspaceUri.fsPath);
    }
  }

  // Prevent error caused by side effect.
  registerSessionResourceCleanup(() => {});

  const output = window.createOutputChannel('Pi Code', { log: true });
  logger.setSink(output);
  context.subscriptions.push(output, { dispose: () => logger.setSink(null) });

  logger.info('Extension activated.');

  try {
    const chatViewProvider = new ChatViewProvider(context);

    context.subscriptions.push(
      window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
      registerCommitMessageCommands(),
      ...registerContextCommands(chatViewProvider),
      languages.registerCodeActionsProvider('*', new PiCodeActionProvider(), PiCodeActionProvider.metadata),
      commands.registerCommand(COMMAND_IDS.settingsButtonClicked, () => {
        chatViewProvider.postMessage({ type: 'show_settings' });
      }),
      // The settings snapshot is memoized for the whole extension, so an edit
      // made anywhere (the settings UI, settings.json, profile sync) has to
      // drop it even when the chat view is closed. The fresh snapshot is
      // mirrored back into the view so it never shows stale values.
      workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration(DEFAULT_APP_ID)) return;
        invalidateAppSettings();
        chatViewProvider.postMessage({ type: 'settings_data', payload: { settings: readAppSettings() } });
      }),
      // Trust gates which project resources Pi is allowed to load, so the cached
      // resource loaders must be rebuilt once the user grants trust.
      workspace.onDidGrantWorkspaceTrust(() => {
        logger.info('Workspace trust granted, reloading agent resources.');
        invalidateAgentResources();
      }),
    );
  } catch (err) {
    // Surface the failure in our output channel before VS Code reports the
    // generic activation failure, so the cause is not lost.
    logger.error('Extension activation failed during registration:', err);
    throw err;
  }
}

export async function deactivate(): Promise<void> {
  cleanupSessionResources();
  // Local MCP servers run as child processes; close them so none outlive the host.
  await mcpGateway.closeAll().catch((err) => logger.error('Failed to close MCP connections:', err));
  // Reap any detached child process trees (e.g. shells spawned by execute_command)
  // that outlived their command so they do not linger after the host exits.
  try {
    killTrackedDetachedChildren();
  } catch (err) {
    logger.error('Failed to kill tracked detached children:', err);
  }
  // The debug interceptor queues writes on a promise chain; drain it before the host exits.
  await flushDebugLog();
}

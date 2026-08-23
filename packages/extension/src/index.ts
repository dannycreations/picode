import { cleanupSessionResources, registerSessionResourceCleanup } from '@earendil-works/pi-ai';
import { commands, languages, window, workspace } from 'vscode';

import { invalidateAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';
import { ChatViewProvider } from '@pi-code/extension/structures/agent-webview/provider';
import { registerCommitMessageCommand } from '@pi-code/extension/structures/commit-message/command';
import {
  registerAddProblemToContextCommand,
  registerAddToContextCommand,
  registerFillCodeCommand,
  registerFixCodeCommand,
} from '@pi-code/extension/structures/context-command/command';
import { PiCodeActionProvider } from '@pi-code/extension/structures/context-command/provider';
import { installFetchInterceptor } from '@pi-code/extension/utilities/interceptor';
import { getWorkspaceUri } from '@pi-code/extension/utilities/vscode';
import { logger } from '@pi-code/shared/core/logger';

import type { ExtensionContext } from 'vscode';

export function activate(context: ExtensionContext): void {
  if (process.env['PI_CODE_DEBUG_HTTP']) {
    const workspaceUri = getWorkspaceUri();
    if (workspaceUri) {
      installFetchInterceptor(workspaceUri.fsPath);
    }
  }

  registerSessionResourceCleanup(() => {});

  const output = window.createOutputChannel('Pi Code', { log: true });
  logger.setSink(output);
  context.subscriptions.push(output, { dispose: () => logger.setSink(null) });

  logger.info('Extension activated.');

  const chatViewProvider = new ChatViewProvider(context);

  context.subscriptions.push(
    window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    registerCommitMessageCommand(),
    registerAddToContextCommand(chatViewProvider),
    registerAddProblemToContextCommand(chatViewProvider),
    registerFillCodeCommand(),
    registerFixCodeCommand(),
    languages.registerCodeActionsProvider('*', new PiCodeActionProvider(), PiCodeActionProvider.metadata),
    commands.registerCommand('pi-code.settingsButtonClicked', () => {
      chatViewProvider.postMessage({ type: 'show_settings' });
    }),
    // Trust gates which project resources Pi is allowed to load, so the cached
    // resource loaders must be rebuilt once the user grants trust.
    workspace.onDidGrantWorkspaceTrust(() => {
      logger.info('Workspace trust granted, reloading agent resources.');
      invalidateAgentResources();
    }),
  );
}

export function deactivate(): void {
  cleanupSessionResources();
}

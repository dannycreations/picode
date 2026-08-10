import { registerSessionResourceCleanup } from '@earendil-works/pi-ai';
import { commands, window } from 'vscode';

import { registerAddToContextCommand } from '@pi-code/extension/structures/add-to-context/command';
import { ChatViewProvider } from '@pi-code/extension/structures/agent-webview/provider';
import { registerCommitMessageCommand } from '@pi-code/extension/structures/commit-message/command';
import { logger } from '@pi-code/shared/core/logger';

import type { ExtensionContext } from 'vscode';

// import { initializeFetchInterceptor } from '@pi-code/extension/utilities/interceptor';

export function activate(context: ExtensionContext): void {
  // initializeFetchInterceptor();
  registerSessionResourceCleanup(() => {});

  const output = window.createOutputChannel('Pi Code', { log: true });
  logger.setSink(output);
  context.subscriptions.push(output, { dispose: () => logger.setSink(null) });

  logger.info('Extension activated.');

  context.subscriptions.push(
    window.registerWebviewViewProvider(ChatViewProvider.viewType, new ChatViewProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    registerCommitMessageCommand(),
    registerAddToContextCommand(),
    commands.registerCommand('pi-code.settingsButtonClicked', () => {
      void ChatViewProvider.postActiveWebviewMessage({ type: 'show_settings' });
    }),
  );
}

export function deactivate(): void {}

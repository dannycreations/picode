import { registerSessionResourceCleanup } from '@earendil-works/pi-ai';
import { commands, window } from 'vscode';

import { logger } from '@extension/core/logger';
import { registerAddToContextCommand } from '@extension/structures/add-to-context/command';
import { ChatViewProvider } from '@extension/structures/agent-webview/provider';
import { registerCommitMessageCommand } from '@extension/structures/commit-message/command';

import type { ExtensionContext } from 'vscode';

// import { initializeFetchInterceptor } from '@extension/utilities/interceptor';

export function activate(context: ExtensionContext): void {
  // initializeFetchInterceptor();
  registerSessionResourceCleanup(() => {});
  logger.info('Extension activated.');

  const chatViewProvider = new ChatViewProvider(context);
  context.subscriptions.push(
    window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const commitMessageDisposable = registerCommitMessageCommand(context);
  context.subscriptions.push(commitMessageDisposable);

  const addToContextDisposable = registerAddToContextCommand();
  context.subscriptions.push(addToContextDisposable);

  const settingsButtonClickedDisposable = commands.registerCommand('pi-code.settingsButtonClicked', () => {
    void ChatViewProvider.postActiveWebviewMessage({ type: 'show_settings' });
  });
  context.subscriptions.push(settingsButtonClickedDisposable);
}

export function deactivate(): void {}

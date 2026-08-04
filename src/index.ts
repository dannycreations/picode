import { commands, ExtensionContext, window } from 'vscode';

import { Logger } from '@extension/core/logger';
import { ChatViewProvider } from '@extension/core/webview';
import { registerAddToContextCommand } from '@extension/structures/add-to-context/command';
import { registerCommitMessageCommand } from '@extension/structures/commit-message/command';

// import { initializeFetchInterceptor } from '@extension/utilities/interceptor';

export function activate(context: ExtensionContext): void {
  // initializeFetchInterceptor();
  const outputChannel = window.createOutputChannel('Pi Code');
  const logger = new Logger(outputChannel, 'Pi Code');
  logger.info('Extension activated.');

  const chatViewProvider = new ChatViewProvider(context);
  context.subscriptions.push(
    window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const commitMessageLogger = new Logger(outputChannel, 'Commit Message');
  const commitMessageDisposable = registerCommitMessageCommand(context, commitMessageLogger);
  context.subscriptions.push(commitMessageDisposable);

  const addToContextDisposable = registerAddToContextCommand();
  context.subscriptions.push(addToContextDisposable);

  const settingsButtonClickedDisposable = commands.registerCommand('pi-code.settingsButtonClicked', () => {
    void ChatViewProvider.postActiveWebviewMessage({ type: 'show_settings' });
  });
  context.subscriptions.push(settingsButtonClickedDisposable);
}

export function deactivate(): void {}

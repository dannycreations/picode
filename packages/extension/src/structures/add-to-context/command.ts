import { relative } from 'node:path';
import { commands, window, workspace } from 'vscode';

import { getEffectiveSelection } from '@pi-code/extension/structures/add-to-context/helpers';
import { ChatViewProvider } from '@pi-code/extension/structures/agent-webview/provider';
import { logger } from '@pi-code/shared/logger';

import type { Disposable, TextDocument } from 'vscode';

export function getRelativeFilePath(document: TextDocument): string {
  try {
    const workspaceFolder = workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return document.uri.fsPath;
    }
    const relativePath = relative(workspaceFolder.uri.fsPath, document.uri.fsPath);
    return !relativePath || relativePath.startsWith('..') ? document.uri.fsPath : relativePath;
  } catch (error) {
    logger.error('Error getting file path:', error);
    return document.uri.fsPath;
  }
}

export function registerAddToContextCommand(): Disposable {
  return commands.registerCommand('pi-code.addToContext', async () => {
    const editor = window.activeTextEditor;
    if (!editor) {
      return;
    }

    const document = editor.document;
    const effectiveContext = getEffectiveSelection(document, editor.selection);
    if (!effectiveContext) {
      return;
    }

    const filePath = getRelativeFilePath(document);
    const startLine = effectiveContext.startLine + 1;
    const endLine = effectiveContext.endLine + 1;
    const selectedText = effectiveContext.text;

    // Focus the chat view first
    await commands.executeCommand('pi-code.chatView.focus');

    // Send the message to the webview
    const prompt = `${filePath}:${startLine}-${endLine}\n\`\`\`\n${selectedText}\n\`\`\`\n\n`;
    ChatViewProvider.postActiveWebviewMessage({
      type: 'set_chat_input',
      payload: { text: prompt },
    });
  });
}

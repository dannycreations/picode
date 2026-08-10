import { commands, window } from 'vscode';

import { getEffectiveSelection } from '@pi-code/extension/structures/add-to-context/helpers';
import { ChatViewProvider } from '@pi-code/extension/structures/agent-webview/provider';
import { toRelativePath } from '@pi-code/extension/utilities/vscode';

import type { Disposable } from 'vscode';

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

    // `asRelativePath` handles multi-root workspaces and falls back to the
    // absolute path when the document lives outside the workspace.
    const filePath = toRelativePath(document.uri);
    const startLine = effectiveContext.startLine + 1;
    const endLine = effectiveContext.endLine + 1;

    // Focus the chat view first
    await commands.executeCommand('pi-code.chatView.focus');

    // Send the message to the webview
    const prompt = `${filePath}:${startLine}-${endLine}\n\`\`\`\n${effectiveContext.text}\n\`\`\`\n\n`;
    ChatViewProvider.postActiveWebviewMessage({
      type: 'set_chat_input',
      payload: { text: prompt },
    });
  });
}

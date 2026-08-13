import { commands, languages, Range, window } from 'vscode';

import { getEffectiveSelection } from '@pi-code/extension/structures/add-to-context/helpers';
import { ChatViewProvider } from '@pi-code/extension/structures/agent-webview/provider';
import { toRelativePath } from '@pi-code/extension/utilities/vscode';

import type { Disposable } from 'vscode';

export function registerAddToContextCommand(chatViewProvider: ChatViewProvider): Disposable {
  return commands.registerCommand('pi-code.addToContext', async (...args: any[]) => {
    let filePath: string;
    let selectedText: string;
    let startLine: number;
    let endLine: number;

    const editor = window.activeTextEditor;

    if (args.length >= 4) {
      [filePath, selectedText, startLine, endLine] = args;
    } else {
      if (!editor) {
        return;
      }
      const document = editor.document;
      const effectiveContext = getEffectiveSelection(document, editor.selection);
      if (!effectiveContext) {
        return;
      }
      filePath = toRelativePath(document.uri);
      startLine = effectiveContext.startLine + 1;
      endLine = effectiveContext.endLine + 1;
      selectedText = effectiveContext.text;
    }

    await commands.executeCommand('pi-code.chatView.focus');

    const prompt = `${filePath}:${startLine}-${endLine}\n\`\`\`\n${selectedText}\n\`\`\`\n\n`;
    chatViewProvider.postMessage({ type: 'set_chat_input', payload: { text: prompt } });
  });
}

export function registerFixCodeCommand(chatViewProvider: ChatViewProvider): Disposable {
  return commands.registerCommand('pi-code.fixCode', async (...args: any[]) => {
    let filePath: string;
    let selectedText: string;
    let startLine: number;
    let endLine: number;
    let diagnostics: any[] = [];

    const editor = window.activeTextEditor;

    if (args.length >= 4) {
      [filePath, selectedText, startLine, endLine, diagnostics = []] = args;
    } else {
      if (!editor) {
        return;
      }
      const document = editor.document;
      const effectiveContext = getEffectiveSelection(document, editor.selection);
      if (!effectiveContext) {
        return;
      }
      filePath = toRelativePath(document.uri);
      startLine = effectiveContext.startLine + 1;
      endLine = effectiveContext.endLine + 1;
      selectedText = effectiveContext.text;

      const selectionRange = new Range(
        effectiveContext.startLine,
        0,
        effectiveContext.endLine,
        document.lineAt(effectiveContext.endLine).text.length,
      );

      const allDiagnostics = languages.getDiagnostics(document.uri);
      const intersecting = allDiagnostics.filter((d) => {
        const r1 = selectionRange;
        const r2 = d.range;
        if (r1.end.line < r2.start.line || (r1.end.line === r2.start.line && r1.end.character <= r2.start.character)) {
          return false;
        }
        if (r2.end.line < r1.start.line || (r2.end.line === r1.start.line && r2.end.character <= r1.start.character)) {
          return false;
        }
        return true;
      });

      diagnostics = intersecting.map((d) => ({
        message: d.message,
        source: d.source,
        code: d.code !== undefined && d.code !== null ? (typeof d.code === 'object' ? d.code.value : d.code) : undefined,
      }));
    }

    let diagnosticText = '';
    if (diagnostics.length > 0) {
      diagnosticText = `Current problems:\n${diagnostics
        .map((d) => `- [${d.source || 'Error'}] ${d.message}${d.code ? ` (${d.code})` : ''}`)
        .join('\n')}`;
    }

    await commands.executeCommand('pi-code.chatView.focus');

    const prompt = `Fix this issues at ${filePath}:${startLine}-${endLine}\n\n${diagnosticText}\n\n\`\`\`\n${selectedText}\n\`\`\`\n\n`;
    chatViewProvider.postMessage({ type: 'set_chat_input', payload: { text: prompt } });
  });
}

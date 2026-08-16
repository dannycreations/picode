import { commands, languages, Range, window } from 'vscode';

import { getSelectionContext, mapDiagnostics } from '@pi-code/extension/structures/add-to-context/helpers';
import { ChatViewProvider } from '@pi-code/extension/structures/agent-webview/provider';

import type { Disposable } from 'vscode';
import type { MappedDiagnostic } from '@pi-code/extension/structures/add-to-context/helpers';

interface ResolvedSelection {
  readonly filePath: string;
  readonly selectedText: string;
  readonly startLine: number;
  readonly endLine: number;
}

function resolveSelection(args: any[]): ResolvedSelection | null {
  if (args.length >= 4) {
    const [filePath, selectedText, startLine, endLine] = args;
    return { filePath, selectedText, startLine, endLine };
  }

  const editor = window.activeTextEditor;
  if (!editor) return null;

  const context = getSelectionContext(editor.document, editor.selection);
  if (!context) return null;

  return {
    filePath: context.filePath,
    startLine: context.selection.startLine + 1,
    endLine: context.selection.endLine + 1,
    selectedText: context.selection.text,
  };
}

export function registerAddToContextCommand(chatViewProvider: ChatViewProvider): Disposable {
  return commands.registerCommand('pi-code.addToContext', async (...args: any[]) => {
    const selection = resolveSelection(args);
    if (!selection) return;

    await commands.executeCommand('pi-code.chatView.focus');

    const prompt = `${selection.filePath}:${selection.startLine}-${selection.endLine}\n\`\`\`\n${selection.selectedText}\n\`\`\`\n\n`;
    chatViewProvider.postMessage({ type: 'set_chat_input', payload: { text: prompt } });
  });
}

export function registerFixCodeCommand(chatViewProvider: ChatViewProvider): Disposable {
  return commands.registerCommand('pi-code.fixCode', async (...args: any[]) => {
    const selection = resolveSelection(args);
    if (!selection) return;

    let diagnosticText = '';
    const passedDiagnostics = args[4] as MappedDiagnostic[] | undefined;

    if (Array.isArray(passedDiagnostics) && passedDiagnostics.length > 0) {
      diagnosticText = `Current problems:\n${passedDiagnostics
        .map((d) => `- [${d.source || 'Error'}] ${d.message}${d.code ? ` (${d.code})` : ''}`)
        .join('\n')}`;
    } else {
      // Fallback when invoked without pre-computed diagnostics (e.g. from a keybinding).
      const editor = window.activeTextEditor;
      if (editor) {
        const selectionRange = new Range(
          selection.startLine - 1,
          0,
          selection.endLine - 1,
          editor.document.lineAt(selection.endLine - 1).text.length,
        );

        const intersecting = languages.getDiagnostics(editor.document.uri).filter((d) => {
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

        const diagnostics = mapDiagnostics(intersecting);
        if (diagnostics.length > 0) {
          diagnosticText = `Current problems:\n${diagnostics
            .map((d) => `- [${d.source || 'Error'}] ${d.message}${d.code ? ` (${d.code})` : ''}`)
            .join('\n')}`;
        }
      }
    }

    await commands.executeCommand('pi-code.chatView.focus');

    const prompt = `Fix this issues\n\n${diagnosticText}\n\n${selection.filePath}:${selection.startLine}-${selection.endLine}\n\`\`\`\n${selection.selectedText}\n\`\`\`\n\n`;
    chatViewProvider.postMessage({ type: 'set_chat_input', payload: { text: prompt } });
  });
}

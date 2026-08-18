import { formatThrownValue } from '@earendil-works/pi-ai';
import { commands, languages, ProgressLocation, Range, window } from 'vscode';

import { completePrompt } from '@pi-code/extension/structures/agent-runtime/complete';
import { ChatViewProvider } from '@pi-code/extension/structures/agent-webview/provider';
import { getSelectionContext, mapDiagnostics } from '@pi-code/extension/structures/context-command/helpers';
import { extractCodeFenceMessage } from '@pi-code/extension/utilities/markdown';
import { getWorkspaceCwd } from '@pi-code/extension/utilities/vscode';
import { logger } from '@pi-code/shared/core/logger';

import type { Diagnostic, Disposable } from 'vscode';
import type { MappedDiagnostic } from '@pi-code/extension/structures/context-command/helpers';

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

export function registerAddProblemToContextCommand(chatViewProvider: ChatViewProvider): Disposable {
  return commands.registerCommand('pi-code.addProblemToContext', async (...args: any[]) => {
    const selection = resolveSelection(args);
    if (!selection) return;

    const passedDiagnostics = args[4] as MappedDiagnostic[] | undefined;
    const diagnosticText =
      Array.isArray(passedDiagnostics) && passedDiagnostics.length > 0
        ? formatDiagnosticBlock(passedDiagnostics)
        : collectSelectionDiagnostics(selection);

    await commands.executeCommand('pi-code.chatView.focus');

    const prompt = `${diagnosticText}\n\n${selection.filePath}:${selection.startLine}-${selection.endLine}\n\`\`\`\n${selection.selectedText}\n\`\`\`\n\n`;
    chatViewProvider.postMessage({ type: 'set_chat_input', payload: { text: prompt } });
  });
}

function formatDiagnosticBlock(diagnostics: readonly MappedDiagnostic[]): string {
  const lines = diagnostics.map((d) => `- [${d.source || 'Error'}] ${d.message}${d.code ? ` (${d.code})` : ''}`).join('\n');
  return `Current problems:\n${lines}`;
}

function intersectsSelection(selectionRange: Range, diagnostic: Diagnostic): boolean {
  const r1 = selectionRange;
  const r2 = diagnostic.range;
  if (r1.end.line < r2.start.line || (r1.end.line === r2.start.line && r1.end.character <= r2.start.character)) {
    return false;
  }
  if (r2.end.line < r1.start.line || (r2.end.line === r1.start.line && r2.end.character <= r1.start.character)) {
    return false;
  }
  return true;
}

function collectSelectionDiagnostics(selection: ResolvedSelection): string {
  const editor = window.activeTextEditor;
  if (!editor) return '';

  const selectionRange = new Range(selection.startLine - 1, 0, selection.endLine - 1, editor.document.lineAt(selection.endLine - 1).text.length);

  const intersecting = languages.getDiagnostics(editor.document.uri).filter((d) => intersectsSelection(selectionRange, d));
  const diagnostics = mapDiagnostics(intersecting);
  return diagnostics.length > 0 ? formatDiagnosticBlock(diagnostics) : '';
}

async function runInlineCompletion(cwd: string, selection: ResolvedSelection, prompt: string, progressTitle: string): Promise<void> {
  const editor = window.activeTextEditor;
  if (!editor) {
    window.showErrorMessage('No active editor to apply the changes to.');
    return;
  }

  try {
    const raw = await window.withProgress({ location: ProgressLocation.Notification, title: progressTitle, cancellable: false }, () =>
      completePrompt(cwd, prompt),
    );

    const replacement = extractCodeFenceMessage(raw);
    if (!replacement) {
      window.showWarningMessage('The model returned an empty response. No changes applied.');
      return;
    }

    const doc = editor.document;
    const startLine = Math.max(selection.startLine - 1, 0);
    const endLine = Math.min(selection.endLine - 1, doc.lineCount - 1);
    const range = new Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);

    const applied = await editor.edit((builder) => builder.replace(range, replacement));
    if (!applied) {
      window.showErrorMessage('Failed to apply the generated code to the file.');
    }
  } catch (error) {
    const message = `Failed to generate code: ${formatThrownValue(error)}`;
    logger.error(message, error);
    window.showErrorMessage(message);
  }
}

export function registerFillCodeCommand(): Disposable {
  return commands.registerCommand('pi-code.fillCode', async (...args: any[]) => {
    const selection = resolveSelection(args);
    if (!selection) return;

    const cwd = getWorkspaceCwd();
    if (!cwd) {
      window.showErrorMessage('No workspace folder is open.');
      return;
    }

    const prompt =
      'Replace the following code with a complete, working implementation that preserves and satisfies the specified contract and requirements. ' +
      'Preserve the original indentation of the replaced lines. Return only the replacement code, with no explanations.\n\n' +
      `${selection.filePath}:${selection.startLine}-${selection.endLine}\n` +
      '```\n' +
      `${selection.selectedText}\n` +
      '```\n\n';

    await runInlineCompletion(cwd, selection, prompt, 'Filling code with Pi...');
  });
}

export function registerFixCodeCommand(): Disposable {
  return commands.registerCommand('pi-code.fixCode', async (...args: any[]) => {
    const selection = resolveSelection(args);
    if (!selection) return;

    const cwd = getWorkspaceCwd();
    if (!cwd) {
      window.showErrorMessage('No workspace folder is open.');
      return;
    }

    const passedDiagnostics = args[4] as MappedDiagnostic[] | undefined;
    const diagnosticText =
      Array.isArray(passedDiagnostics) && passedDiagnostics.length > 0
        ? formatDiagnosticBlock(passedDiagnostics)
        : collectSelectionDiagnostics(selection);

    const prompt =
      'Fix the issues in the following code. Replace it with corrected code that resolves the problems listed below. ' +
      'Preserve the original indentation of the replaced lines. Return only the replacement code, with no explanations.\n\n' +
      `${diagnosticText ? `${diagnosticText}\n\n` : ''}` +
      `${selection.filePath}:${selection.startLine}-${selection.endLine}\n` +
      '```\n' +
      `${selection.selectedText}\n` +
      '```\n\n';

    await runInlineCompletion(cwd, selection, prompt, 'Fixing code with Pi...');
  });
}

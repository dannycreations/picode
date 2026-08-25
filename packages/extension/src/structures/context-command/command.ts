import { commands, languages, ProgressLocation, Range, window } from 'vscode';

import { FILL_CODE_PROMPT, FIX_CODE_PROMPT } from '@pi-code/extension/core/prompt';
import { completeAndExtract } from '@pi-code/extension/structures/agent-runtime/helpers/complete';
import { mapDiagnostics, resolveSelectionFromDocument } from '@pi-code/extension/structures/context-command/helpers';
import { getWorkspaceCwd, reportError } from '@pi-code/extension/utilities/vscode';
import { COMMAND_IDS } from '@pi-code/shared/core/constants';

import type { Diagnostic, Disposable } from 'vscode';
import type { ChatViewProvider } from '@pi-code/extension/structures/agent-webview/provider';
import type { MappedDiagnostic, ResolvedSelection } from '@pi-code/extension/structures/context-command/helpers';

function resolveSelection(args: unknown[]): ResolvedSelection | null {
  const [passed] = args;
  if (passed) return passed as ResolvedSelection;

  const editor = window.activeTextEditor;
  if (!editor) return null;

  return resolveSelectionFromDocument(editor.document, editor.selection);
}

function formatSelectionBlock(selection: ResolvedSelection): string {
  return `${selection.filePath}:${selection.startLine}-${selection.endLine}\n\`\`\`\n${selection.selectedText}\n\`\`\`\n\n`;
}

function getDiagnosticText(args: unknown[], selection: ResolvedSelection): string {
  const passedDiagnostics = args[1] as MappedDiagnostic[] | undefined;
  return Array.isArray(passedDiagnostics) && passedDiagnostics.length > 0
    ? formatDiagnosticBlock(passedDiagnostics)
    : collectSelectionDiagnostics(selection);
}

function registerChatInputCommand(
  sender: ChatViewProvider,
  id: string,
  buildPrompt: (selection: ResolvedSelection, args: unknown[]) => string,
): Disposable {
  return commands.registerCommand(id, async (...args: unknown[]) => {
    const selection = resolveSelection(args);
    if (!selection) return;

    const prompt = buildPrompt(selection, args);

    await commands.executeCommand(COMMAND_IDS.chatViewFocus);
    sender.postMessage({ type: 'set_chat_input', payload: { text: prompt } });
  });
}

export function registerAddToContextCommand(sender: ChatViewProvider): Disposable {
  return registerChatInputCommand(sender, COMMAND_IDS.addToContext, formatSelectionBlock);
}

export function registerAddProblemToContextCommand(sender: ChatViewProvider): Disposable {
  return registerChatInputCommand(sender, COMMAND_IDS.addProblemToContext, (selection, args) => {
    const diagnosticText = getDiagnosticText(args, selection);
    return `${diagnosticText}\n\n${formatSelectionBlock(selection)}`;
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

  const controller = new AbortController();
  try {
    const replacement = await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: progressTitle,
        cancellable: true,
      },
      (_progress, token) => {
        token.onCancellationRequested(() => controller.abort());
        return completeAndExtract(cwd, prompt, controller.signal);
      },
    );
    if (controller.signal.aborted) {
      window.showInformationMessage('Code generation cancelled.');
      return;
    }
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
    if (!controller.signal.aborted) {
      reportError('Failed to generate code', error);
    }
  }
}

function registerInlineEditCommand(
  id: string,
  progressTitle: string,
  buildPrompt: (selection: ResolvedSelection, diagnosticText: string) => string,
): Disposable {
  return commands.registerCommand(id, async (...args: unknown[]) => {
    const selection = resolveSelection(args);
    if (!selection) return;

    const cwd = getWorkspaceCwd();
    if (!cwd) {
      window.showErrorMessage('No workspace folder is open.');
      return;
    }

    const diagnosticText = getDiagnosticText(args, selection);
    const prompt = buildPrompt(selection, diagnosticText);
    await runInlineCompletion(cwd, selection, prompt, progressTitle);
  });
}

export function registerFillCodeCommand(): Disposable {
  return registerInlineEditCommand(
    COMMAND_IDS.fillCode,
    'Filling code with Pi...',
    (selection) => FILL_CODE_PROMPT + '\n\n' + formatSelectionBlock(selection),
  );
}

export function registerFixCodeCommand(): Disposable {
  return registerInlineEditCommand(
    COMMAND_IDS.fixCode,
    'Fixing code with Pi...',
    (selection, diagnosticText) => FIX_CODE_PROMPT + '\n\n' + (diagnosticText ? `${diagnosticText}\n\n` : '') + formatSelectionBlock(selection),
  );
}

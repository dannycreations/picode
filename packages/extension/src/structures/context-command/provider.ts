import { CodeAction, CodeActionKind, Selection } from 'vscode';

import { mapDiagnostics, resolveSelectionFromDocument } from '@pi-code/extension/structures/context-command/helpers';
import { COMMAND_IDS } from '@pi-code/shared/core/constants';

import type { CancellationToken, CodeActionContext, CodeActionProvider, CodeActionProviderMetadata, Range, TextDocument } from 'vscode';

export class PiCodeActionProvider implements CodeActionProvider {
  public static readonly metadata: CodeActionProviderMetadata = {
    providedCodeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorRewrite],
  };

  public provideCodeActions(document: TextDocument, range: Range | Selection, context: CodeActionContext, _token: CancellationToken): CodeAction[] {
    const selection = range instanceof Selection ? range : new Selection(range.start, range.end);
    const resolved = resolveSelectionFromDocument(document, selection);
    if (!resolved) {
      return [];
    }

    const actions: CodeAction[] = [];

    const addAction = new CodeAction('Add to Pi Context', CodeActionKind.RefactorRewrite);
    addAction.command = {
      command: COMMAND_IDS.addToContext,
      title: 'Add to Pi Context',
      arguments: [resolved],
    };
    actions.push(addAction);

    const diagnostics = context.diagnostics;
    if (diagnostics.length > 0) {
      const fixAction = new CodeAction('Add to Pi Context', CodeActionKind.QuickFix);
      // Map diagnostics to a clean JSON-serializable object format for the command
      const mappedDiagnostics = mapDiagnostics(diagnostics);
      fixAction.command = {
        command: COMMAND_IDS.addProblemToContext,
        title: 'Add to Pi Context',
        arguments: [resolved, mappedDiagnostics],
      };
      fixAction.isPreferred = true;
      actions.push(fixAction);
    }

    return actions;
  }
}

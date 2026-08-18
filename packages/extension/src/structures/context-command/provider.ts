import { CodeAction, CodeActionKind, Selection } from 'vscode';

import { getEffectiveSelection, mapDiagnostics } from '@pi-code/extension/structures/context-command/helpers';
import { toRelativePath } from '@pi-code/extension/utilities/vscode';

import type { CancellationToken, CodeActionContext, CodeActionProvider, CodeActionProviderMetadata, Range, TextDocument } from 'vscode';

export class PiCodeActionProvider implements CodeActionProvider {
  public static readonly metadata: CodeActionProviderMetadata = {
    providedCodeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorRewrite],
  };

  public provideCodeActions(document: TextDocument, range: Range | Selection, context: CodeActionContext, _token: CancellationToken): CodeAction[] {
    const selection = range instanceof Selection ? range : new Selection(range.start, range.end);
    const effectiveContext = getEffectiveSelection(document, selection);
    if (!effectiveContext) {
      return [];
    }

    const filePath = toRelativePath(document.uri);
    const startLine = effectiveContext.startLine + 1;
    const endLine = effectiveContext.endLine + 1;

    const actions: CodeAction[] = [];

    const addAction = new CodeAction('Add to Pi Context', CodeActionKind.RefactorRewrite);
    addAction.command = {
      command: 'pi-code.addToContext',
      title: 'Add to Pi Context',
      arguments: [filePath, effectiveContext.text, startLine, endLine],
    };
    actions.push(addAction);

    const diagnostics = context.diagnostics;
    if (diagnostics.length > 0) {
      const fixAction = new CodeAction('Add to Pi Context', CodeActionKind.QuickFix);
      // Map diagnostics to a clean JSON-serializable object format for the command
      const mappedDiagnostics = mapDiagnostics(diagnostics);
      fixAction.command = {
        command: 'pi-code.addProblemToContext',
        title: 'Add to Pi Context',
        arguments: [filePath, effectiveContext.text, startLine, endLine, mappedDiagnostics],
      };
      fixAction.isPreferred = true;
      actions.push(fixAction);
    }

    return actions;
  }
}

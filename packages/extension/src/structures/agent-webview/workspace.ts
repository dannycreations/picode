import { isAbsolute } from 'node:path';
import { commands, Position, Range, Selection, TextEditorRevealType, Uri, window, workspace } from 'vscode';

import { extensionForMimeType, parseBase64DataUrl } from '@pi-code/extension/utilities/codec';

import type { TextEditor } from 'vscode';

export class WorkspaceService {
  public constructor(private readonly storageUri: Uri) {}

  public async openFile(cwd: string, relativePath: string, line?: number): Promise<void> {
    const uri = this.resolveTargetUri(cwd, relativePath);
    const doc = await workspace.openTextDocument(uri);
    const target = line ? doc.validateRange(new Range(new Position(line - 1, 0), new Position(line - 1, 0))) : undefined;
    await window.showTextDocument(uri, { selection: target && new Selection(target.start, target.end) });
  }

  public async openFileInChanges(cwd: string, relativePath: string, line?: number): Promise<void> {
    const uri = this.resolveTargetUri(cwd, relativePath);

    try {
      await commands.executeCommand('git.openChange', uri);
    } catch {
      // Git extension unavailable: fall back to a plain editor open.
      await this.openFile(cwd, relativePath, line);
      return;
    }

    const editor = await this.findEditorForUri(uri);
    if (!editor) {
      // The diff didn't open (e.g. untracked file with no changes): fall back.
      await this.openFile(cwd, relativePath, line);
      return;
    }

    if (line === undefined) return;
    const pos = new Position(Math.max(0, line - 1), 0);
    editor.selection = new Selection(pos, pos);
    editor.revealRange(new Range(pos, pos), TextEditorRevealType.InCenter);
  }

  public async openRawTask(sessionFilePath?: string): Promise<void> {
    if (!sessionFilePath) {
      window.showWarningMessage('No session file path found for this task.');
      return;
    }

    try {
      const doc = await workspace.openTextDocument(Uri.file(sessionFilePath));
      await window.showTextDocument(doc);
    } catch {
      window.showWarningMessage('The session file for this task is not available yet.');
    }
  }

  public async openBase64Image(dataUrl: string): Promise<void> {
    const parts = parseBase64DataUrl(dataUrl);
    if (!parts) return;

    const target = Uri.joinPath(this.storageUri, 'images', `pi-code-img-${Date.now()}.${extensionForMimeType(parts.mimeType)}`);

    await workspace.fs.createDirectory(Uri.joinPath(this.storageUri, 'images'));
    await workspace.fs.writeFile(target, Buffer.from(parts.data, 'base64'));
    await commands.executeCommand('vscode.open', target);
  }

  public async saveImage(dataUrl: string, filename: string): Promise<void> {
    const parts = parseBase64DataUrl(dataUrl);
    if (!parts) return;

    const uri = await window.showSaveDialog({
      defaultUri: Uri.file(filename),
      filters: { 'PNG Images': ['png'] },
    });
    if (!uri) return;

    await workspace.fs.writeFile(uri, Buffer.from(parts.data, 'base64'));
  }

  private async findEditorForUri(uri: Uri, attempts = 10, delayMs = 50): Promise<TextEditor | undefined> {
    const target = uri.toString();
    for (let attempt = 0; attempt < attempts; attempt++) {
      const editor = window.activeTextEditor;
      if (editor && editor.document.uri.toString() === target) {
        return editor;
      }
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return undefined;
  }

  private resolveTargetUri(cwd: string, relativePath: string): Uri {
    return isAbsolute(relativePath) ? Uri.file(relativePath) : Uri.joinPath(Uri.file(cwd), relativePath);
  }
}

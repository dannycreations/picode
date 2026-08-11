import { isAbsolute } from 'node:path';
import { commands, Position, Range, Selection, Uri, window, workspace } from 'vscode';

import { extensionForMimeType, parseBase64DataUrl } from '@pi-code/extension/utilities/codec';

export class WorkspaceService {
  public constructor(private readonly storageUri: Uri) {}

  public async openFile(cwd: string, relativePath: string, line?: number): Promise<void> {
    const uri = isAbsolute(relativePath) ? Uri.file(relativePath) : Uri.joinPath(Uri.file(cwd), relativePath);
    const doc = await workspace.openTextDocument(uri);
    const target = line ? doc.validateRange(new Range(new Position(line - 1, 0), new Position(line - 1, 0))) : undefined;
    await window.showTextDocument(uri, { selection: target && new Selection(target.start, target.end) });
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
}

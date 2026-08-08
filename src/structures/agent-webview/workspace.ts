import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Range, Uri, window, workspace } from 'vscode';

import { extensionForMimeType, parseBase64DataUrl } from '@extension/utilities/codec';

export class WorkspaceService {
  public async openFile(cwd: string, relativePath: string, line?: number): Promise<void> {
    const filePath = resolve(cwd, relativePath);
    const doc = await workspace.openTextDocument(Uri.file(filePath));
    const selection = line ? new Range(line - 1, 0, line - 1, 0) : undefined;
    await window.showTextDocument(doc, { selection });
  }

  public async openRawTask(sessionFilePath?: string): Promise<void> {
    if (!sessionFilePath) {
      window.showWarningMessage('No session file path found for this task.');
      return;
    }
    const doc = await workspace.openTextDocument(Uri.file(sessionFilePath));
    await window.showTextDocument(doc);
  }

  public async openBase64Image(dataUrl: string): Promise<void> {
    const parts = parseBase64DataUrl(dataUrl);
    if (!parts) return;

    const ext = extensionForMimeType(parts.mimeType);
    const tempFilePath = resolve(tmpdir(), `pi-code-img-${Date.now()}.${ext}`);

    await writeFile(tempFilePath, Buffer.from(parts.data, 'base64'));

    const { commands } = await import('vscode');
    await commands.executeCommand('vscode.open', Uri.file(tempFilePath));
  }
}

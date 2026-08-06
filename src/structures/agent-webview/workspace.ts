import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Range, Uri, window, workspace } from 'vscode';

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
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return;

    const [, mimeType, base64Data] = match;
    const ext = mimeType.split('/')[1] || 'png';
    const tempFilePath = resolve(tmpdir(), `pi-code-img-${Date.now()}.${ext}`);

    await writeFile(tempFilePath, Buffer.from(base64Data, 'base64'));

    const { commands } = await import('vscode');
    await commands.executeCommand('vscode.open', Uri.file(tempFilePath));
  }
}

import type { WebviewApi as InternalWebviewApi } from 'vscode-webview';
import type { WebviewToExtensionMessage } from '@pi-code/shared/core/protocol';
import type { ActiveTaskState } from '@pi-code/shared/core/types';

interface WebviewApi extends Omit<InternalWebviewApi<unknown>, 'postMessage'> {
  postMessage(message: WebviewToExtensionMessage): void;
}

export const vscode: WebviewApi | null = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

export function postCompactMessage(activeTask: ActiveTaskState | null): void {
  vscode?.postMessage({
    type: 'compact',
    id: activeTask?.id ?? '',
    path: activeTask?.path,
    title: activeTask?.title ?? '',
  });
}

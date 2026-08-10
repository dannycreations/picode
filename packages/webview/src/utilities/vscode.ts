import type { WebviewApi as InternalWebviewApi } from 'vscode-webview';
import type { WebviewToExtensionMessage } from '@pi-code/shared/core/protocol';

export interface WebviewApi extends Omit<InternalWebviewApi<unknown>, 'postMessage'> {
  postMessage(message: WebviewToExtensionMessage): void;
}

export const vscode: WebviewApi | null = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

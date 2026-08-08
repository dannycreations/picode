import type { WebviewToExtensionMessage } from '@pi-code/shared/core/protocol';

interface WebviewApi {
  readonly postMessage: (message: WebviewToExtensionMessage) => void;
}

declare const acquireVsCodeApi: () => WebviewApi;

export const vscode = (() => {
  if (typeof acquireVsCodeApi !== 'undefined') {
    return acquireVsCodeApi();
  }
  return null;
})();

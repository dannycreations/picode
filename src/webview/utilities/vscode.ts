import { WebviewToExtensionMessage } from '@extension/types/webview';

export interface WebviewApi<State> {
  readonly postMessage: (message: WebviewToExtensionMessage) => void;
  readonly getState: () => State | undefined;
  readonly setState: (newState: State) => State;
}

declare const acquireVsCodeApi: <State>() => WebviewApi<State>;

export const vscode = (() => {
  if (typeof acquireVsCodeApi !== 'undefined') {
    return acquireVsCodeApi<unknown>();
  }
  return null;
})();

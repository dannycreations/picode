import { useCallback, useEffect, useState } from 'react';

import { vscode } from '@pi-code/webview/utilities/vscode';

import type { Dispatch, SetStateAction } from 'react';
import type { ExtensionToWebviewMessage, HistoryItem, HistoryScope } from '@pi-code/shared/core/protocol';

export interface UseChatHistoryProps {
  readonly view: 'chat' | 'history' | 'settings';
  readonly scope: HistoryScope;
}

export interface UseChatHistoryReturn {
  readonly pastTasks: HistoryItem[];
  readonly setPastTasks: Dispatch<SetStateAction<HistoryItem[]>>;
  readonly onMessage: (msg: ExtensionToWebviewMessage) => void;
}

export const useChatHistory = ({ view, scope }: UseChatHistoryProps): UseChatHistoryReturn => {
  const [pastTasks, setPastTasks] = useState<HistoryItem[]>([]);

  useEffect(() => {
    if (view !== 'history') return;
    vscode?.postMessage({ type: 'get_history', scope });
  }, [view, scope]);

  const onMessage = useCallback((msg: ExtensionToWebviewMessage): void => {
    switch (msg.type) {
      case 'init_data':
        setPastTasks(msg.payload.history);
        break;

      case 'history_data':
        setPastTasks(msg.payload.history);
        break;
    }
  }, []);

  return { pastTasks, setPastTasks, onMessage };
};

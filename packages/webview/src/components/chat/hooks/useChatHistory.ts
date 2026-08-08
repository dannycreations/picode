import { useCallback, useEffect, useRef, useState } from 'react';

import { vscode } from '@pi-code/webview/utilities/vscode';

import type { Dispatch, SetStateAction } from 'react';
import type { ExtensionToWebviewMessage, HistoryItem } from '@pi-code/shared/protocol';

export type HistoryScope = 'current' | 'all';

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

  const loadedHistoryScopesRef = useRef<Set<HistoryScope>>(new Set());
  const requestedHistoryScopeRef = useRef<HistoryScope | null>(null);
  const historyDirtyRef = useRef(true);

  useEffect(() => {
    if (view !== 'history') return;
    if (loadedHistoryScopesRef.current.has(scope) && !historyDirtyRef.current) return;

    requestedHistoryScopeRef.current = scope;
    vscode?.postMessage({ type: 'get_history', scope });
  }, [view, scope]);

  const onMessage = useCallback((msg: ExtensionToWebviewMessage): void => {
    switch (msg.type) {
      case 'init_data': {
        const { history } = msg.payload;
        setPastTasks(history);
        loadedHistoryScopesRef.current.add('current');
        historyDirtyRef.current = false;
        break;
      }

      case 'history_data':
        setPastTasks(msg.payload.history);
        if (requestedHistoryScopeRef.current) {
          loadedHistoryScopesRef.current.add(requestedHistoryScopeRef.current);
          requestedHistoryScopeRef.current = null;
        }
        historyDirtyRef.current = false;
        break;

      case 'history_deleted':
        setPastTasks((prev) => prev.filter((item) => !msg.payload.paths.includes(item.path)));
        break;
    }
  }, []);

  return { pastTasks, setPastTasks, onMessage };
};

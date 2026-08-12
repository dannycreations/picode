import { useCallback, useEffect, useRef, useState } from 'react';

import { vscode } from '@pi-code/webview/utilities/vscode';

import type { Dispatch, SetStateAction } from 'react';
import type { ExtensionToWebviewMessage, HistoryItem, HistoryScope } from '@pi-code/shared/core/protocol';

interface UseChatHistoryProps {
  readonly view: 'chat' | 'history' | 'settings';
}

interface UseChatHistoryReturn {
  readonly pastTasks: HistoryItem[];
  readonly setPastTasks: Dispatch<SetStateAction<HistoryItem[]>>;
  readonly scope: HistoryScope;
  readonly setScope: Dispatch<SetStateAction<HistoryScope>>;
  readonly onMessage: (msg: ExtensionToWebviewMessage) => void;
}

export const useChatHistory = ({ view }: UseChatHistoryProps): UseChatHistoryReturn => {
  const [scope, setScope] = useState<HistoryScope>('current');
  const [historyByScope, setHistoryByScope] = useState<Record<HistoryScope, HistoryItem[]>>({ current: [], all: [] });
  const fetchedScopes = useRef<Set<HistoryScope>>(new Set());

  const pastTasks = historyByScope[scope];

  const requestScope = useCallback((target: HistoryScope): void => {
    if (fetchedScopes.current.has(target)) return;
    fetchedScopes.current.add(target);
    vscode?.postMessage({ type: 'get_history', scope: target });
  }, []);

  useEffect(() => {
    if (view === 'history') requestScope(scope);
  }, [view, scope, requestScope]);

  const setPastTasks = useCallback<Dispatch<SetStateAction<HistoryItem[]>>>(
    (updater) => {
      setHistoryByScope((prev) => {
        const current = prev[scope] ?? [];
        const next = typeof updater === 'function' ? (updater as (p: HistoryItem[]) => HistoryItem[])(current) : updater;
        return { ...prev, [scope]: next };
      });
    },
    [scope],
  );

  const onMessage = useCallback(
    (msg: ExtensionToWebviewMessage): void => {
      switch (msg.type) {
        case 'init_data':
          fetchedScopes.current.add('current');
          setHistoryByScope((prev) => ({ ...prev, current: msg.payload.history }));
          break;

        case 'history_data':
          fetchedScopes.current.add(scope);
          setHistoryByScope((prev) => ({ ...prev, [scope]: msg.payload.history }));
          break;
      }
    },
    [scope],
  );

  return { pastTasks, setPastTasks, scope, setScope, onMessage };
};

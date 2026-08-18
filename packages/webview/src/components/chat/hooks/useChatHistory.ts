import { useCallback, useEffect, useRef, useState } from 'react';

import { HISTORY_SCOPES } from '@pi-code/shared/core/protocol';
import { vscode } from '@pi-code/webview/utilities/vscode';

import type { Dispatch, SetStateAction } from 'react';
import type { ExtensionToWebviewMessage, HistoryItem, HistoryScope } from '@pi-code/shared/core/protocol';

function emptyHistoryByScope(): Record<HistoryScope, HistoryItem[]> {
  const record = {} as Record<HistoryScope, HistoryItem[]>;
  for (const scope of HISTORY_SCOPES) {
    record[scope] = [];
  }
  return record;
}

interface UseChatHistoryProps {
  readonly view: 'chat' | 'history' | 'settings';
}

interface UseChatHistoryReturn {
  readonly pastTasks: HistoryItem[];
  readonly scope: HistoryScope;
  readonly setScope: Dispatch<SetStateAction<HistoryScope>>;
  readonly deleteSessions: (paths: string[]) => void;
  readonly onMessage: (msg: ExtensionToWebviewMessage) => void;
}

export const useChatHistory = ({ view }: UseChatHistoryProps): UseChatHistoryReturn => {
  const [scope, setScope] = useState<HistoryScope>('current');
  const [historyByScope, setHistoryByScope] = useState<Record<HistoryScope, HistoryItem[]>>(emptyHistoryByScope());
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

  // Optimistically drop the deleted rows from every cached scope (not just the
  // visible one) so a later switch to "All" re-fetches instead of showing
  // stale entries, then ask the host to remove the files.
  const deleteSessions = useCallback((paths: string[]): void => {
    const removed = new Set(paths);
    setHistoryByScope((prev) => {
      const next = { ...prev };
      for (const scope of HISTORY_SCOPES) {
        next[scope] = prev[scope].filter((item) => !removed.has(item.path));
      }
      return next;
    });
    vscode?.postMessage({ type: 'delete_sessions', paths });
  }, []);

  const onMessage = useCallback((msg: ExtensionToWebviewMessage): void => {
    switch (msg.type) {
      case 'init_data':
        fetchedScopes.current.add('current');
        break;

      case 'history_data': {
        const { scope, items } = msg.payload;
        fetchedScopes.current.add(scope);
        // The host can push a scope more than once (initial load plus the
        // post-cancel refresh); skip entries already cached so they don't repeat.
        setHistoryByScope((prev) => {
          const known = new Set(prev[scope].map((entry) => entry.id));
          const additions = items.filter((item) => !known.has(item.id));
          return { ...prev, [scope]: [...prev[scope], ...additions] };
        });
        break;
      }

      case 'archive_result': {
        // The task moved between sessions/ and archives/. Update the caches
        // directly so the change is instant and no filesystem re-scan runs.
        const { id, path, archived, title } = msg.payload;
        const item: HistoryItem = { id, path, task: title, ts: Date.now() };
        setHistoryByScope((prev) => {
          if (archived) {
            // Left active history; it reappears under Archives when that tab opens.
            return {
              current: prev.current.filter((entry) => entry.id !== id),
              all: prev.all.filter((entry) => entry.id !== id),
              archives: prev.archives,
            };
          }
          // Returned to active history; surface it in current/all immediately.
          return {
            current: [item, ...prev.current.filter((entry) => entry.id !== id)],
            all: [item, ...prev.all.filter((entry) => entry.id !== id)],
            archives: prev.archives.filter((entry) => entry.id !== id),
          };
        });
        // Archives/All re-scan on open; current stays as updated above.
        fetchedScopes.current.delete('archives');
        fetchedScopes.current.delete('all');
        break;
      }
    }
  }, []);

  return { pastTasks, scope, setScope, deleteSessions, onMessage };
};

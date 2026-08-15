import { useCallback, useEffect, useRef, useState } from 'react';

import { vscode } from '@pi-code/webview/utilities/vscode';

import type { Dispatch, SetStateAction } from 'react';
import type { ExtensionToWebviewMessage, HistoryItem, HistoryScope } from '@pi-code/shared/core/protocol';

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
  const [historyByScope, setHistoryByScope] = useState<Record<HistoryScope, HistoryItem[]>>({ current: [], all: [], archives: [] });
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

  useEffect(() => {
    if (view === 'chat') setScope('current');
  }, [view, setScope]);

  // Optimistically drop the deleted rows from every cached scope (not just the
  // visible one) so a later switch to "All" re-fetches instead of showing
  // stale entries, then ask the host to remove the files.
  const deleteSessions = useCallback((paths: string[]): void => {
    const removed = new Set(paths);
    setHistoryByScope((prev) => ({
      current: prev.current.filter((item) => !removed.has(item.path)),
      all: prev.all.filter((item) => !removed.has(item.path)),
      archives: prev.archives.filter((item) => !removed.has(item.path)),
    }));
    vscode?.postMessage({ type: 'delete_sessions', paths });
  }, []);

  // The response carries its own scope, so a reply that arrives after the user
  // switched tabs still lands in the cache entry it was requested for.
  const onMessage = useCallback((msg: ExtensionToWebviewMessage): void => {
    switch (msg.type) {
      case 'init_data':
        fetchedScopes.current.add('current');
        setHistoryByScope((prev) => ({ ...prev, current: msg.payload.history }));
        break;

      case 'history_data':
        fetchedScopes.current.add(msg.payload.scope);
        setHistoryByScope((prev) => ({ ...prev, [msg.payload.scope]: msg.payload.history }));
        break;

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

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

function zeroEpochs(): Record<HistoryScope, number> {
  const record = {} as Record<HistoryScope, number>;
  for (const scope of HISTORY_SCOPES) {
    record[scope] = 0;
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
  // Highest history_data epoch applied per scope. Each host refresh bumps the
  // epoch: the first chunk of a refresh resets the scope, later chunks append,
  // and any chunk with a lower epoch is a stale remnant we drop. This makes the
  // webview a pure projection of the host, so deletions and re-streams cannot
  // leave a stale or duplicated entry behind.
  const latestEpoch = useRef<Record<HistoryScope, number>>(zeroEpochs());
  // Scopes we have already asked the host to stream, so switching tabs does not
  // re-scan the disk.
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

  // Drop the rows now so the list reacts before the host round-trips. The host
  // re-streams the scopes after deleting, so this is just instant feedback.
  const deleteSessions = useCallback((paths: string[]): void => {
    const removed = new Set(paths);
    setHistoryByScope((prev) => {
      const next = { ...prev };
      for (const target of HISTORY_SCOPES) {
        next[target] = prev[target].filter((item) => !removed.has(item.path));
      }
      return next;
    });
    vscode?.postMessage({ type: 'delete_sessions', paths });
  }, []);

  const onMessage = useCallback((msg: ExtensionToWebviewMessage): void => {
    switch (msg.type) {
      case 'init_data':
        fetchedScopes.current.add('current');
        latestEpoch.current = zeroEpochs();
        break;

      case 'history_data': {
        const { scope, epoch, items } = msg.payload;
        const prevEpoch = latestEpoch.current[scope];
        if (epoch < prevEpoch) return;
        const isNewRefresh = epoch > prevEpoch;
        latestEpoch.current[scope] = epoch;
        setHistoryByScope((prev) => ({ ...prev, [scope]: isNewRefresh ? items : [...prev[scope], ...items] }));
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

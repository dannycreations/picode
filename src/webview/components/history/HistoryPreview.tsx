import { Calendar, Check, Copy, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDialog } from '@extension/webview/components/shared/ConfirmDialog';

import type { FC, MouseEvent } from 'react';
import type { HistoryItem } from '@extension/types/webview';

interface HistoryPreviewProps {
  readonly history: HistoryItem[];
  readonly onSelectTask: (item: HistoryItem) => void;
  readonly onViewAllHistory: () => void;
  readonly onDeleteTask: (path: string) => void;
}

export const HistoryPreview: FC<HistoryPreviewProps> = ({ history, onSelectTask, onViewAllHistory, onDeleteTask }) => {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [deleteConfirmPath, setDeleteConfirmPath] = useState<string | null>(null);

  const formatTimeAgo = (ts: number) => {
    const diffMs = Date.now() - ts;
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    if (diffHours < 24) {
      if (diffHours === 0) return 'Just now';
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    }
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  const handleCopyPrompt = (e: MouseEvent, text: string, path: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  const handleDelete = (e: MouseEvent, path: string) => {
    e.stopPropagation();
    setDeleteConfirmPath(path);
  };

  if (history.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 mt-4">
      <div className="flex flex-wrap items-center justify-between mt-2 mb-2">
        <h2 className="font-semibold text-[calc(var(--vscode-font-size)*1.1)] grow m-0 text-[var(--vscode-foreground)]">Recent Tasks</h2>
        <button
          onClick={onViewAllHistory}
          className="text-xs text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-textLink-foreground)] transition-colors cursor-pointer bg-transparent border-none"
        >
          View All History
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {history.slice(0, 5).map((item) => (
          <div
            key={item.id}
            data-testid={`task-item-${item.id}`}
            onClick={() => onSelectTask(item)}
            className="cursor-pointer group bg-[var(--vscode-editor-background)] rounded p-3 border border-[var(--vscode-panel-border)]/50 hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
          >
            <div className="flex flex-col gap-2">
              <div className="text-sm font-light text-[var(--vscode-foreground)] leading-normal line-clamp-2">{item.task}</div>
              <div className="text-xs text-[var(--vscode-descriptionForeground)] flex justify-between items-center">
                <div className="flex gap-1.5 items-center opacity-80">
                  <Calendar size={10} className="opacity-80" />
                  <span>{formatTimeAgo(item.ts)}</span>
                </div>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={(e) => handleCopyPrompt(e, item.task, item.path)}
                    title={copiedPath === item.path ? 'Copied prompt!' : 'Copy prompt'}
                    className="p-1 bg-transparent border-none text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] cursor-pointer"
                  >
                    {copiedPath === item.path ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, item.path)}
                    title="Delete task"
                    className="p-1 bg-transparent border-none text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-errorForeground)] cursor-pointer"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        isOpen={deleteConfirmPath !== null}
        title="Delete Task"
        description="Are you sure you want to delete this task?"
        onConfirm={() => {
          if (deleteConfirmPath) {
            onDeleteTask(deleteConfirmPath);
          }
          setDeleteConfirmPath(null);
        }}
        onCancel={() => setDeleteConfirmPath(null)}
      />
    </div>
  );
};

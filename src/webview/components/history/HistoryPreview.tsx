import { useCallback, useState } from 'react';

import { HistoryCard } from '@extension/webview/components/history/HistoryCard';
import { useCopyPrompt } from '@extension/webview/components/history/hooks/useCopyPrompt';
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
  const [deleteConfirmPath, setDeleteConfirmPath] = useState<string | null>(null);
  const { copiedPath, copyToClipboard } = useCopyPrompt();

  const handleDeleteSingle = useCallback((e: MouseEvent, path: string) => {
    e.stopPropagation();
    setDeleteConfirmPath(path);
  }, []);

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
          <HistoryCard
            key={item.id}
            item={item}
            copiedPath={copiedPath}
            lineClamp={2}
            testId={`task-item-${item.id}`}
            onClick={() => onSelectTask(item)}
            onCopy={copyToClipboard}
            onDelete={handleDeleteSingle}
          />
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

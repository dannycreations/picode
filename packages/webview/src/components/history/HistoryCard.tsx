import { cn } from 'cnfast';
import { Calendar } from 'lucide-react';

import { TaskActions } from '@pi-code/webview/components/shared/TaskActions';
import { formatTimeAgo } from '@pi-code/webview/utilities/common';

import type { FC } from 'react';
import type { HistoryItem } from '@pi-code/shared/core/protocol';

interface HistoryCardProps {
  readonly item: HistoryItem;
  readonly isSelected?: boolean;
  readonly isSelectionMode?: boolean;
  readonly onClick: () => void;
  readonly onToggleSelect?: (path: string) => void;
  readonly onDelete: (path: string) => void;
  readonly onViewRaw?: (path: string) => void;
  readonly onExport?: (item: HistoryItem) => void;
  readonly lineClamp?: number;
}

export const HistoryCard: FC<HistoryCardProps> = ({
  item,
  isSelected = false,
  isSelectionMode = false,
  onClick,
  onToggleSelect,
  onDelete,
  onViewRaw,
  onExport,
  lineClamp = 3,
}) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        'group flex items-start gap-3 p-3 bg-[var(--vscode-editor-background)] rounded border transition-colors cursor-pointer relative',
        isSelected
          ? 'border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-hoverBackground)]/30'
          : 'border-[var(--vscode-panel-border)]/50 hover:bg-[var(--vscode-list-hoverBackground)]',
      )}
    >
      {isSelectionMode && onToggleSelect && (
        <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(item.path)} className="cursor-pointer" />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className={cn('text-xs leading-relaxed font-light text-[var(--vscode-foreground)]', lineClamp === 2 ? 'line-clamp-2' : 'line-clamp-3')}>
          {item.task}
        </div>

        <div className="flex items-center justify-between text-xs text-[var(--vscode-descriptionForeground)] mt-1">
          <div className="flex items-center gap-1.5 opacity-80">
            <Calendar size={10} className="opacity-80" />
            <span>{formatTimeAgo(item.ts)}</span>
          </div>

          {!isSelectionMode && (
            <TaskActions
              iconSize={12}
              buttonClassName="p-1 rounded bg-transparent border-none cursor-pointer flex items-center transition-colors hover:bg-[var(--vscode-list-hoverBackground)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
              deleteButtonClassName="p-1 rounded bg-transparent border-none cursor-pointer flex items-center transition-colors hover:bg-[var(--vscode-list-hoverBackground)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-errorForeground)]"
              copyText={item.task}
              onExport={onExport ? () => onExport(item) : undefined}
              onDelete={() => onDelete(item.path)}
              onViewRaw={onViewRaw ? () => onViewRaw(item.path) : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
};

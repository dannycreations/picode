import { cn } from 'cn';
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
}) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        'group flex items-start gap-3 p-3 bg-vscode-editor-background rounded border transition-colors cursor-pointer relative',
        isSelected
          ? 'border-vscode-focusBorder bg-vscode-list-hoverBackground/30'
          : 'border-vscode-panel-border/50 hover:bg-vscode-list-hoverBackground',
      )}
    >
      {isSelectionMode && onToggleSelect && (
        <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(item.path)} className="cursor-pointer" />
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="text-xs leading-relaxed font-light text-vscode-foreground line-clamp-2">{item.task}</div>

        <div className="flex items-center justify-between text-muted mt-1">
          <div className="flex items-center gap-1.5 opacity-80">
            <Calendar size={10} className="opacity-80" />
            <span>{formatTimeAgo(item.timestamp)}</span>
          </div>

          {!isSelectionMode && (
            <TaskActions
              iconSize={12}
              buttonClassName="icon-button"
              deleteButtonClassName="icon-button hover:text-vscode-errorForeground"
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

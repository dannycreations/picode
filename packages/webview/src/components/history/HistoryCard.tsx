import { cn } from 'cnfast';
import { Calendar, Check, Copy, Download, FileJson, Trash2 } from 'lucide-react';

import { HistoryButton } from '@pi-code/webview/components/history/HistoryButton';
import { useCopyToClipboard } from '@pi-code/webview/hooks/useCopyToClipboard';
import { formatTimeAgo } from '@pi-code/webview/utilities/common';

import type { FC, MouseEvent } from 'react';
import type { HistoryItem } from '@pi-code/shared/core/protocol';

interface HistoryCardProps {
  readonly item: HistoryItem;
  readonly isSelected?: boolean;
  readonly isSelectionMode?: boolean;
  readonly onClick: () => void;
  readonly onToggleSelect?: (path: string) => void;
  readonly onDelete: (e: MouseEvent, path: string) => void;
  readonly onViewRaw?: (path: string) => void;
  readonly onExport?: (item: HistoryItem) => void;
  readonly testId?: string;
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
  testId,
  lineClamp = 3,
}) => {
  const { showCopy, copy } = useCopyToClipboard();

  return (
    <div
      data-testid={testId}
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
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(item.path)}
            className="cursor-pointer accent-[var(--vscode-focusBorder)]"
          />
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
            <div className="flex flex-row items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {onExport && (
                <HistoryButton
                  icon={Download}
                  title="Export task messages"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExport(item);
                  }}
                />
              )}
              <HistoryButton
                icon={showCopy ? Check : Copy}
                title={showCopy ? 'Copied prompt!' : 'Copy prompt'}
                onClick={(e) => {
                  e.stopPropagation();
                  void copy(item.task);
                }}
              />
              <HistoryButton icon={Trash2} title="Delete task" danger onClick={(e) => onDelete(e, item.path)} />
              {onViewRaw && (
                <HistoryButton
                  icon={FileJson}
                  title="View raw task"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewRaw(item.path);
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

import { cn } from 'cnfast';
import { Check, Copy, Download, FileJson, Trash2 } from 'lucide-react';

import { useCopyToClipboard } from '@pi-code/webview/hooks/useCopyToClipboard';

import type { FC, MouseEvent } from 'react';

interface TaskActionsProps {
  readonly iconSize: number;
  readonly buttonClassName: string;
  readonly deleteButtonClassName?: string;
  readonly wrapperClassName?: string;
  readonly copyText: string;
  readonly onExport?: () => void;
  readonly onDelete?: () => void;
  readonly onViewRaw?: () => void;
}

export const TaskActions: FC<TaskActionsProps> = ({
  iconSize,
  buttonClassName,
  deleteButtonClassName,
  wrapperClassName,
  copyText,
  onExport,
  onDelete,
  onViewRaw,
}) => {
  const { showCopy, copy } = useCopyToClipboard();

  const stop = (e: MouseEvent): void => e.stopPropagation();

  return (
    <div className={cn('flex flex-row items-center gap-1', wrapperClassName)} onClick={stop}>
      {onExport && (
        <button
          type="button"
          title="Export task messages"
          className={buttonClassName}
          onClick={(e) => {
            stop(e);
            onExport();
          }}
        >
          <Download size={iconSize} />
        </button>
      )}
      <button type="button" title={showCopy ? 'Copied prompt!' : 'Copy prompt'} className={buttonClassName} onClick={(e) => void copy(copyText, e)}>
        {showCopy ? <Check size={iconSize} /> : <Copy size={iconSize} />}
      </button>
      {onDelete && (
        <button
          type="button"
          title="Delete task"
          className={deleteButtonClassName ?? buttonClassName}
          onClick={(e) => {
            stop(e);
            onDelete();
          }}
        >
          <Trash2 size={iconSize} />
        </button>
      )}
      {onViewRaw && (
        <button
          type="button"
          title="View raw task"
          className={buttonClassName}
          onClick={(e) => {
            stop(e);
            onViewRaw();
          }}
        >
          <FileJson size={iconSize} />
        </button>
      )}
    </div>
  );
};

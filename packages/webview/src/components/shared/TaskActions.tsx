import { cn } from 'cnfast';
import { Download, FileJson, Trash2 } from 'lucide-react';

import { CopyButton } from '@pi-code/webview/components/shared/CopyButton';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

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
  const stop = (e: MouseEvent): void => e.stopPropagation();

  return (
    <div className={cn('flex flex-row items-center gap-1', wrapperClassName)} onClick={stop}>
      {onExport && (
        <Tooltip content="Export task">
          <button
            type="button"
            className={buttonClassName}
            onClick={(e) => {
              stop(e);
              onExport();
            }}
          >
            <Download size={iconSize} />
          </button>
        </Tooltip>
      )}
      <Tooltip content="Copy prompt">
        <CopyButton text={copyText} size={iconSize} className={buttonClassName} />
      </Tooltip>
      {onDelete && (
        <Tooltip content="Delete task">
          <button
            type="button"
            className={deleteButtonClassName ?? buttonClassName}
            onClick={(e) => {
              stop(e);
              onDelete();
            }}
          >
            <Trash2 size={iconSize} />
          </button>
        </Tooltip>
      )}
      {onViewRaw && (
        <Tooltip content="View raw task">
          <button
            type="button"
            className={buttonClassName}
            onClick={(e) => {
              stop(e);
              onViewRaw();
            }}
          >
            <FileJson size={iconSize} />
          </button>
        </Tooltip>
      )}
    </div>
  );
};

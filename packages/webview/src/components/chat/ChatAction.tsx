import { memo } from 'react';

import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC } from 'react';

interface ChatActionProps {
  readonly hasTask: boolean;
  readonly isArchived: boolean;
  readonly showScrollToBottom: boolean;
  readonly isRunning: boolean;
  readonly isCompacting: boolean;
  readonly isAwaitingApproval: boolean;
  readonly onScrollToBottom: () => void;
  readonly onCancelTask: () => void;
  readonly onCloseTask?: () => void;
  readonly onContinueTask?: () => void;
  readonly closeLabel?: string;
  readonly cancelLabel?: string;
}

export const ChatAction: FC<ChatActionProps> = memo(
  ({
    hasTask,
    isArchived,
    showScrollToBottom,
    isRunning,
    isCompacting,
    isAwaitingApproval,
    onScrollToBottom,
    onCancelTask,
    onCloseTask,
    onContinueTask,
    closeLabel,
    cancelLabel = 'Cancel Task',
  }) => {
    // Archived tasks are read-only, so their action bar is hidden entirely.
    if (isArchived) return null;

    const showCancel = isRunning || isCompacting;
    const showContinue = onContinueTask !== undefined;
    const showClose = onCloseTask !== undefined;
    // The bar only appears when it has something to offer: a way back to the
    // bottom, a way to stop the run, or the actions of a settled task.
    const showActionButtons = hasTask && (showScrollToBottom || showCancel || (!isAwaitingApproval && (showContinue || showClose)));

    if (!showActionButtons) return null;

    return (
      <div className="flex gap-2 px-3.5 pt-2 shrink-0">
        {showScrollToBottom ? (
          <Tooltip content="Scroll to bottom of chat">
            <button onClick={onScrollToBottom} className="action-button w-full">
              <span className="codicon codicon-chevron-down mr-1" style={{ fontSize: 'inherit', lineHeight: 'inherit' }} />
            </button>
          </Tooltip>
        ) : showCancel ? (
          <button onClick={onCancelTask} className="action-button action-button-secondary w-full">
            <span className="w-1.5 h-1.5 rounded-full bg-vscode-errorForeground animate-pulse mr-1" />
            {cancelLabel}
          </button>
        ) : (
          <>
            {showContinue && (
              <button onClick={onContinueTask} className="action-button flex-1">
                Continue
              </button>
            )}
            {showClose && (
              <button onClick={onCloseTask} className="action-button action-button-secondary flex-1">
                {closeLabel ?? 'New Task'}
              </button>
            )}
          </>
        )}
      </div>
    );
  },
);

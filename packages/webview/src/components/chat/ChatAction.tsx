import { memo } from 'react';

import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC } from 'react';
import type { ScrollTarget } from '@pi-code/webview/hooks/useAutoScroll';

interface ChatActionProps {
  readonly hasTask: boolean;
  readonly isArchived: boolean;
  readonly isComposerHidden: boolean;
  readonly scrollTarget: ScrollTarget | null;
  readonly isRunning: boolean;
  readonly isCompacting: boolean;
  readonly isAwaitingApproval: boolean;
  readonly onScrollTo: (target: ScrollTarget) => void;
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
    isComposerHidden,
    scrollTarget,
    isRunning,
    isCompacting,
    isAwaitingApproval,
    onScrollTo,
    onCancelTask,
    onCloseTask,
    onContinueTask,
    closeLabel,
    cancelLabel = 'Cancel Task',
  }) => {
    // Archived tasks are read-only: navigation stays available, but mutating
    // actions (cancel / continue / close) are suppressed.
    const showCancel = !isArchived && (isRunning || isCompacting);
    const showContinue = !isArchived && onContinueTask !== undefined;
    const showClose = !isArchived && onCloseTask !== undefined;
    // The bar only appears when it has something to offer: a way back to the
    // top/bottom, a way to stop the run, or the actions of a settled task.
    const showActionButtons = hasTask && (scrollTarget !== null || showCancel || (!isAwaitingApproval && (showContinue || showClose)));

    if (!showActionButtons) return null;

    return (
      <div className={`flex gap-2 px-3.5 pt-2 shrink-0${isComposerHidden ? ' pb-2' : ''}`}>
        {scrollTarget !== null ? (
          <Tooltip content={`Scroll to ${scrollTarget} of chat`}>
            <button onClick={() => onScrollTo(scrollTarget)} aria-label={`Scroll to ${scrollTarget} of chat`} className="action-button w-full">
              <span
                className={`codicon codicon-chevron-${scrollTarget === 'top' ? 'up' : 'down'} mr-1`}
                style={{ fontSize: 'inherit', lineHeight: 'inherit' }}
              />
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

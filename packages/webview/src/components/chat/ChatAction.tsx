import { hasPendingApproval } from '@pi-code/webview/components/chat/helpers/message';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC } from 'react';
import type { ActiveTaskState } from '@pi-code/shared/core/types';

interface ChatActionProps {
  readonly showScrollToBottom: boolean;
  readonly isAgentRunning: boolean;
  readonly activeTask: ActiveTaskState | null;
  readonly onScrollToBottom: () => void;
  readonly onCancelTask: () => void;
  readonly onCloseTask: () => void;
  readonly onContinueTask: () => void;
  readonly isArchived?: boolean;
}

export const ChatAction: FC<ChatActionProps> = ({
  showScrollToBottom,
  isAgentRunning,
  activeTask,
  onScrollToBottom,
  onCancelTask,
  onCloseTask,
  onContinueTask,
  isArchived,
}) => {
  // Archived tasks are read-only, so their action bar is hidden entirely.
  if (isArchived) return null;

  const isToolApprovalPending = activeTask ? hasPendingApproval(activeTask.messages) : false;
  const showActionButtons = activeTask && (showScrollToBottom || isAgentRunning || !isToolApprovalPending);

  if (!showActionButtons) return null;

  return (
    <div className="flex gap-2 px-3.5 pt-2 shrink-0">
      {showScrollToBottom ? (
        <Tooltip content="Scroll to bottom of chat">
          <button onClick={onScrollToBottom} className="action-button w-full">
            <span className="codicon codicon-chevron-down mr-1" style={{ fontSize: 'inherit', lineHeight: 'inherit' }} />
          </button>
        </Tooltip>
      ) : isAgentRunning ? (
        <button onClick={onCancelTask} className="action-button action-button-secondary w-full">
          <span className="w-1.5 h-1.5 rounded-full bg-vscode-errorForeground animate-pulse mr-1" />
          Cancel Task
        </button>
      ) : (
        <>
          <button onClick={onContinueTask} className="action-button flex-1">
            Continue
          </button>
          <button onClick={onCloseTask} className="action-button action-button-secondary flex-1">
            New Task
          </button>
        </>
      )}
    </div>
  );
};

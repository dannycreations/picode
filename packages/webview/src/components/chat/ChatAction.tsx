import type { FC } from 'react';
import type { ActiveTaskState } from '@pi-code/shared/core/protocol';

interface ChatActionProps {
  readonly showScrollToBottom: boolean;
  readonly isAgentRunning: boolean;
  readonly activeTask: ActiveTaskState | null;
  readonly onScrollToBottom: () => void;
  readonly onCancelTask: () => void;
  readonly onCloseTask: () => void;
  readonly onContinueTask: () => void;
}

export const ChatAction: FC<ChatActionProps> = ({
  showScrollToBottom,
  isAgentRunning,
  activeTask,
  onScrollToBottom,
  onCancelTask,
  onCloseTask,
  onContinueTask,
}) => {
  const isToolApprovalPending = activeTask?.messages.some((msg) => msg.toolStatus === 'approval');
  const showActionButtons = activeTask && (showScrollToBottom || isAgentRunning || (!isAgentRunning && !isToolApprovalPending));

  if (!showActionButtons) return null;

  return (
    <div className="flex gap-2 px-3.5 pt-2 shrink-0">
      {showScrollToBottom ? (
        <button
          onClick={onScrollToBottom}
          title="Scroll to bottom of chat"
          className="w-full py-1.5 text-xs font-semibold rounded bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground border-none cursor-pointer flex items-center justify-center gap-1.5"
        >
          <span className="codicon codicon-chevron-down mr-1" />
        </button>
      ) : isAgentRunning ? (
        <button
          onClick={onCancelTask}
          className="w-full py-1.5 text-xs font-semibold rounded bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground border border-vscode-editorGroup-border cursor-pointer flex items-center justify-center gap-1.5"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse mr-1" />
          Cancel Task
        </button>
      ) : activeTask.messages.some((msg) => msg.toolName === 'attempt_completion') ? (
        <button
          onClick={onCloseTask}
          className="w-full py-1.5 text-xs font-semibold rounded bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground border-none cursor-pointer flex items-center justify-center gap-1.5"
        >
          Start New Task
        </button>
      ) : (
        <>
          <button
            onClick={onContinueTask}
            className="flex-1 py-1.5 text-xs font-semibold rounded bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground border-none cursor-pointer flex items-center justify-center gap-1.5"
          >
            Continue
          </button>
          <button
            onClick={onCloseTask}
            className="flex-1 py-1.5 text-xs font-semibold rounded bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground border border-vscode-editorGroup-border cursor-pointer flex items-center justify-center gap-1.5"
          >
            New Task
          </button>
        </>
      )}
    </div>
  );
};

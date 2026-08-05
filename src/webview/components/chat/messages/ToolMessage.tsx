import { cn } from 'cnfast';
import { CheckCircle, ChevronUp, ClipboardCheck, Play, PocketKnife, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';

import { Markdown } from '@extension/webview/components/chat/markdown/Markdown';
import { getToolDiffMeta, getToolLanguage, parseCompletionResult } from '@extension/webview/components/chat/messages/helpers/common';
import { MessageHeader } from '@extension/webview/components/chat/messages/MessageHeader';
import { CodeBlock } from '@webview/components/chat/CodeBlock';

import type { FC } from 'react';
import type { ChatMessage } from '@extension/types/webview';

interface ToolMessageProps {
  readonly message: ChatMessage;
  readonly onApproveTool: (msgId: string) => void;
  readonly onDenyTool: (msgId: string) => void;
}

export const ToolMessage: FC<ToolMessageProps> = ({ message, onApproveTool, onDenyTool }) => {
  const [isDiffExpanded, setIsDiffExpanded] = useState(message.toolName === 'attempt_completion');

  if (message.toolName === 'attempt_completion') {
    const completionResult = parseCompletionResult(message.toolArgs, message.diff);
    const isRunning = message.toolStatus === 'running';

    return (
      <div className="group flex flex-col gap-1.5">
        <MessageHeader
          icon={
            isRunning ? (
              <div className="w-3.5 h-3.5 border-2 border-vscode-focusBorder border-t-transparent rounded-full animate-spin shrink-0" />
            ) : (
              <ClipboardCheck size={14} className="text-emerald-500 shrink-0" />
            )
          }
          title="Task Completed"
          titleClassName="text-emerald-500"
          timestamp={message.ts}
        />
        <div className="ml-6 text-sm leading-normal text-vscode-foreground select-text">
          <Markdown markdown={completionResult || (isRunning ? 'Completing task...' : '')} />
        </div>
      </div>
    );
  }

  const hasBottomBlock = message.toolStatus === 'approval';
  const { label: diffLabel, icon: diffIcon } = getToolDiffMeta(message.toolName);

  const renderToolStatusIcon = () => {
    switch (message.toolStatus) {
      case 'completed':
        return <CheckCircle size={14} className="text-emerald-500 shrink-0" />;
      case 'denied':
        return <ShieldAlert size={14} className="text-red-500 shrink-0" />;
      case 'running':
        return <div className="w-3.5 h-3.5 border-2 border-vscode-focusBorder border-t-transparent rounded-full animate-spin shrink-0" />;
      default:
        return <PocketKnife size={14} className="text-vscode-focusBorder shrink-0" />;
    }
  };

  return (
    <div className="group flex flex-col gap-1.5">
      <MessageHeader icon={renderToolStatusIcon()} title="Pi Execute" timestamp={message.ts} />

      <div className="ml-6 text-sm">
        <div className="border border-vscode-editorGroup-border rounded-md overflow-hidden bg-vscode-input-background">
          <div
            className={cn(
              'p-3 flex items-start gap-2 select-none',
              message.diff || hasBottomBlock ? 'border-b border-vscode-editorGroup-border/45' : '',
            )}
          >
            <span className="codicon codicon-terminal text-vscode-focusBorder mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-mono text-xs text-vscode-foreground truncate select-text">{message.text}</div>
              {message.toolArgs && (
                <div className="mt-1 font-mono text-[10px] text-vscode-descriptionForeground truncate select-text">Arguments: {message.toolArgs}</div>
              )}
            </div>
          </div>

          {/* Diff / Result Accordion */}
          {message.diff && (
            <div className={hasBottomBlock ? 'border-b border-vscode-editorGroup-border/45' : ''}>
              <button
                onClick={() => setIsDiffExpanded(!isDiffExpanded)}
                className="w-full flex items-center justify-between px-3 py-1.5 bg-vscode-input-background text-[10px] text-vscode-descriptionForeground border-none cursor-pointer text-left hover:bg-vscode-list-hoverBackground select-none"
              >
                <span className="font-semibold flex items-center gap-1.5">
                  <span className={cn('codicon', `codicon-${diffIcon}`, 'pr-0.5')} />
                  {diffLabel}
                </span>
                <ChevronUp size={12} className={cn('transition-transform duration-200', !isDiffExpanded && 'rotate-180')} />
              </button>
              {isDiffExpanded && (
                <div className="border-t border-vscode-editorGroup-border/30 p-2">
                  <CodeBlock source={message.diff} language={getToolLanguage(message.toolName, message.text)} />
                </div>
              )}
            </div>
          )}

          {/* Approval Controls */}
          {message.toolStatus === 'approval' && (
            <div className="p-3 bg-vscode-editorWarning-background/10 flex flex-col gap-2.5">
              <div className="text-xs font-semibold text-vscode-foreground flex items-center gap-1.5 select-none">
                <span className="codicon codicon-question text-vscode-editorWarning-foreground" />
                Tool request waiting for approval
              </div>
              <div className="flex items-center gap-2 select-none">
                <button
                  onClick={() => onApproveTool(message.id)}
                  className="flex-1 py-1.5 text-xs font-semibold rounded bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground border-none cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Play size={12} fill="currentColor" /> Approve
                </button>
                <button
                  onClick={() => onDenyTool(message.id)}
                  className="flex-1 py-1.5 text-xs font-semibold rounded bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground border border-vscode-editorGroup-border cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <X size={12} /> Deny
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

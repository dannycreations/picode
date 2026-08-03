import {
  AlertTriangle,
  CheckCircle,
  ChevronUp,
  GitCommit,
  Info,
  Lightbulb,
  MessageCircle,
  Play,
  PocketKnife,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  User,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { ChatMessage } from '@extension/types/webview';
import { CodeBlock } from '@webview/components/chat/CodeBlock';
import { Markdown } from '@webview/components/chat/Markdown';
import { vscode } from '@webview/utilities/vscode';

import type { FC } from 'react';

interface ChatBodyProps {
  readonly message: ChatMessage;
  readonly isLast: boolean;
  readonly onApproveTool: (msgId: string) => void;
  readonly onDenyTool: (msgId: string) => void;
  readonly onRestoreCheckpoint: (hash: string) => void;
}

const getToolLanguage = (toolName?: string, toolText?: string): string => {
  if (toolName === 'execute_command') {
    return 'shell';
  }
  if (toolName === 'read_file' && toolText) {
    const match = toolText.match(/(?:\.([^./\\]+))$/);
    return match ? match[1] : 'text';
  }
  if (toolName === 'write_file' || toolName === 'edit_file') {
    return 'diff';
  }
  return 'text';
};

export const ChatBody: FC<ChatBodyProps> = ({ message, isLast: _isLast, onApproveTool, onDenyTool, onRestoreCheckpoint }) => {
  const [isReasoningExpanded, setIsReasoningExpanded] = useState(false);
  const [isDiffExpanded, setIsDiffExpanded] = useState(message.toolName === 'update_todo');

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const content = (() => {
    switch (message.sender) {
      case 'user':
        return (
          <div className="group flex flex-col gap-1">
            <div className="flex items-center gap-2.5 mb-1.5 break-words font-semibold text-vscode-foreground opacity-85 select-none">
              <User size={14} className="text-vscode-focusBorder shrink-0" />
              <span className="font-bold">You Said</span>
              <span className="text-[10px] text-vscode-descriptionForeground font-normal ml-auto">{formatTime(message.ts)}</span>
            </div>
            <div className="ml-6 border border-vscode-editorGroup-border rounded bg-vscode-editor-background text-vscode-editor-foreground p-3 text-sm whitespace-pre-wrap leading-normal select-text">
              {message.text.trim()}
              {message.images && message.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[var(--vscode-panel-border)]">
                  {message.images.map((img, idx) => (
                    <div
                      key={idx}
                      onClick={() => vscode?.postMessage({ type: 'open_image', dataUrl: img })}
                      className="relative w-10 h-10 rounded border border-[var(--vscode-panel-border)] overflow-hidden cursor-pointer hover:opacity-80"
                      title="Click to view image"
                    >
                      <img src={img} alt="attachment" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

      case 'assistant': {
        const hasReasoning = !!message.reasoning && message.reasoning.trim() !== '';
        const hasText = !!message.text && message.text.trim() !== '';
        if (!hasReasoning && !hasText) {
          return null;
        }
        return (
          <div className="group flex flex-col gap-1.5">
            {/* Reasoning block */}
            {hasReasoning && (
              <div className={`flex flex-col gap-1.5 ${hasText ? 'mb-2' : ''}`}>
                <div
                  className={`flex items-center gap-2.5 break-words font-semibold text-vscode-foreground opacity-85 select-none cursor-pointer ${isReasoningExpanded ? 'mb-1.5' : ''}`}
                  onClick={() => setIsReasoningExpanded(!isReasoningExpanded)}
                >
                  <Lightbulb size={14} className="text-vscode-focusBorder shrink-0" />
                  <span className="font-bold">Pi Thinking</span>
                  <ChevronUp size={14} className={`transition-transform duration-200 ${!isReasoningExpanded ? 'rotate-180' : ''}`} />
                  <span className="text-[10px] text-vscode-descriptionForeground font-normal ml-auto">{formatTime(message.ts)}</span>
                </div>
                {isReasoningExpanded && (
                  <div className="ml-6 border-l border-vscode-descriptionForeground/20 pl-4 pb-1 text-vscode-descriptionForeground text-xs whitespace-pre-wrap leading-relaxed select-text">
                    {message.reasoning.trim()}
                  </div>
                )}
              </div>
            )}

            {/* Answer block */}
            {hasText && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2.5 mb-1.5 break-words font-semibold text-vscode-foreground opacity-85 select-none">
                  <MessageCircle size={14} className="text-vscode-focusBorder shrink-0" />
                  <span className="font-bold">Pi Said</span>
                  <span className="text-[10px] text-vscode-descriptionForeground font-normal ml-auto">{formatTime(message.ts)}</span>
                </div>
                <div className="ml-6 text-sm leading-normal text-vscode-foreground select-text">
                  <Markdown markdown={message.text} />
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'tool': {
        const hasBottomBlock = message.toolStatus === 'approval';
        const hasDiffBlock = !!message.diff;

        const getToolIcon = () => {
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
            <div className="flex items-center gap-2.5 mb-1.5 break-words font-semibold text-vscode-foreground opacity-85 select-none">
              {getToolIcon()}
              <span className="font-bold">Pi Execute</span>
              <span className="text-[10px] text-vscode-descriptionForeground font-normal ml-auto">{formatTime(message.ts)}</span>
            </div>

            <div className="ml-6 text-sm">
              <div className="border border-vscode-editorGroup-border rounded-md overflow-hidden bg-vscode-input-background">
                <div
                  className={`p-3 flex items-start gap-2 select-none ${
                    hasDiffBlock || hasBottomBlock ? 'border-b border-vscode-editorGroup-border/45' : ''
                  }`}
                >
                  <span className="codicon codicon-terminal text-vscode-focusBorder mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs text-vscode-foreground truncate select-text">{message.text}</div>
                    {message.toolArgs && (
                      <div className="mt-1 font-mono text-[10px] text-vscode-descriptionForeground truncate select-text">
                        Arguments: {message.toolArgs}
                      </div>
                    )}
                  </div>
                </div>

                {/* Show Diff/Result option for tool executions */}
                {message.diff &&
                  (() => {
                    let label = 'File Changes Diff';
                    let icon = 'diff';
                    if (message.toolName === 'execute_command') {
                      label = 'Command Output';
                      icon = 'terminal';
                    } else if (message.toolName === 'read_file') {
                      label = 'File Contents';
                      icon = 'file';
                    } else if (message.toolName === 'update_todo') {
                      label = 'Todo Checklist';
                      icon = 'tasklist';
                    } else if (message.toolName === 'ask_question') {
                      label = 'User Response';
                      icon = 'comment';
                    } else if (message.toolName === 'delete_file') {
                      label = 'Execution Output';
                      icon = 'trash';
                    }
                    return (
                      <div className={hasBottomBlock ? 'border-b border-vscode-editorGroup-border/45' : ''}>
                        <button
                          onClick={() => setIsDiffExpanded(!isDiffExpanded)}
                          className="w-full flex items-center justify-between px-3 py-1.5 bg-vscode-input-background text-[10px] text-vscode-descriptionForeground border-none cursor-pointer text-left hover:bg-vscode-list-hoverBackground select-none"
                        >
                          <span className="font-semibold flex items-center gap-1.5">
                            <span className={`codicon codicon-${icon} pr-0.5`} />
                            {label}
                          </span>
                          <ChevronUp size={12} className={`transition-transform duration-200 ${!isDiffExpanded ? 'rotate-180' : ''}`} />
                        </button>
                        {isDiffExpanded &&
                          (message.toolName === 'update_todo' ? (
                            <div className="p-3 bg-vscode-editor-background border-t border-vscode-editorGroup-border/30 text-vscode-foreground flex flex-col gap-2 select-text">
                              {message.diff.split('\n').map((line, idx) => {
                                const match = line.match(/^(?:-\s*)?\[\s*([ xX\-~])\s*\]\s*(.+)$/);
                                if (match) {
                                  const box = match[1].toLowerCase();
                                  const isChecked = box === 'x';
                                  const isInProgress = box === '-' || box === '~';
                                  const text = match[2];
                                  return (
                                    <div key={idx} className="flex items-center gap-2">
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        readOnly
                                        className="rounded border border-vscode-settings-checkboxBorder accent-vscode-button-background bg-vscode-settings-checkboxBackground cursor-default w-3.5 h-3.5 shrink-0"
                                      />
                                      <span
                                        className={`text-xs ${isChecked ? 'line-through opacity-50' : isInProgress ? 'font-semibold text-vscode-editorWarning-foreground' : ''}`}
                                      >
                                        {isInProgress && (
                                          <span className="mr-1 text-[9px] bg-vscode-editorWarning-background px-1 py-0.5 rounded shrink-0">
                                            In Progress
                                          </span>
                                        )}
                                        {text}
                                      </span>
                                    </div>
                                  );
                                }
                                return (
                                  <div key={idx} className="text-xs text-vscode-descriptionForeground pl-5">
                                    {line}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="border-t border-vscode-editorGroup-border/30 p-2">
                              <CodeBlock source={message.diff} language={getToolLanguage(message.toolName, message.text)} />
                            </div>
                          ))}
                      </div>
                    );
                  })()}

                {/* Tool approval or status block */}
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
      }

      case 'checkpoint':
        return (
          <div className="flex items-center justify-between gap-2 text-xs select-none">
            <div className="flex items-center gap-2 text-vscode-foreground whitespace-nowrap">
              <GitCommit size={14} className="text-vscode-focusBorder shrink-0" />
              <span className="font-bold text-vscode-foreground">Checkpoint saved</span>
              <span className="font-mono bg-vscode-badge-background text-vscode-badge-foreground px-1 py-0.5 rounded text-[10px]">
                {message.checkpointHash || '1a2b3c4'}
              </span>
            </div>
            <button
              onClick={() => onRestoreCheckpoint(message.checkpointHash || '1a2b3c4')}
              className="ml-auto text-[10px] text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground bg-transparent border-none cursor-pointer flex items-center gap-1 font-semibold"
            >
              <RotateCcw size={10} /> Restore
            </button>
          </div>
        );

      case 'api_request': {
        const isRunning = message.toolStatus === 'running';
        const isFailed = message.toolStatus === 'denied';
        return (
          <div
            className={`flex items-center justify-between gap-2 text-xs select-none transition-opacity duration-200 ${isRunning ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}
          >
            <div className="flex items-center gap-2 text-vscode-foreground whitespace-nowrap">
              {isRunning ? (
                <div className="w-3.5 h-3.5 border-2 border-vscode-focusBorder border-t-transparent rounded-full animate-spin shrink-0" />
              ) : isFailed ? (
                <AlertTriangle size={14} className="text-[var(--vscode-editorError-foreground)] shrink-0" />
              ) : (
                <RefreshCw size={14} className="text-vscode-focusBorder shrink-0" />
              )}
              <span className={`font-semibold ${isFailed ? 'text-[var(--vscode-editorError-foreground)]' : 'text-vscode-foreground'}`}>
                {isRunning ? 'API Request...' : isFailed ? 'API Request Failed' : 'API Request'}
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {message.cost !== undefined && message.cost > 0 && (
                <span className="text-[10px] text-vscode-dropdown-foreground border border-vscode-dropdown-border/50 px-1.5 py-0.5 rounded bg-vscode-dropdown-background font-mono">
                  ${message.cost.toFixed(4)}
                </span>
              )}
              <span className="text-[10px] text-vscode-descriptionForeground font-normal">{formatTime(message.ts)}</span>
            </div>
          </div>
        );
      }

      case 'error':
        return (
          <div className="p-3 rounded-md bg-[var(--vscode-editorError-background)]/10 border border-[var(--vscode-editorError-foreground)]/30 flex gap-2.5 text-xs text-[var(--vscode-editorError-foreground)]">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm mb-1 select-none">Execution Error</div>
              <div className="font-mono whitespace-pre-wrap break-all leading-normal text-vscode-foreground select-text">
                {message.errorMessage || message.text}
              </div>
            </div>
          </div>
        );

      case 'info':
        return (
          <div className="flex items-center justify-between gap-2 text-xs select-none">
            <div className="flex items-center gap-2 text-vscode-foreground whitespace-nowrap">
              <Info size={14} className="text-vscode-focusBorder shrink-0" />
              <span className="font-semibold text-vscode-foreground">{message.text}</span>
            </div>
            <span className="text-[10px] text-vscode-descriptionForeground font-normal ml-auto">{formatTime(message.ts)}</span>
          </div>
        );

      default:
        return null;
    }
  })();

  if (!content) return null;

  return <div className="px-[15px] py-[10px] pr-[6px] relative border-b border-vscode-editorGroup-border/30">{content}</div>;
};

import { cn } from 'cnfast';
import { Check, ChevronDown, ChevronRight, CloudDownload, CloudUpload, Coins, Copy, Download, FileJson, FoldVertical, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { TodoView } from '@webview/components/chat/TodoView';
import { useCopyToClipboard } from '@webview/hooks/useCopyToClipboard';

import type { ComponentType, FC, MouseEvent } from 'react';
import type { ChatMessage } from '@extension/types/webview';

export interface ChatHeaderProps {
  readonly title: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheWrites?: number;
  readonly cacheReads?: number;
  readonly totalCost: number;
  readonly contextTokens: number;
  readonly contextLimit: number;
  readonly messages: ChatMessage[];
  readonly onClose: () => void;
  readonly onCompact: () => void;
  readonly onExport?: () => void;
  readonly onDelete?: () => void;
  readonly onViewRaw?: () => void;
}

interface IconButtonProps {
  readonly icon: ComponentType<{ size?: number; className?: string }>;
  readonly title: string;
  readonly onClick: (e: MouseEvent) => void;
  readonly disabled?: boolean;
}

const IconButton: FC<IconButtonProps> = ({ icon: Icon, title, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={cn(
      'relative inline-flex items-center justify-center bg-transparent border-none p-1.5 rounded-md text-vscode-foreground opacity-80 transition-all duration-150 active:bg-vscode-list-hoverBackground/20',
      !disabled ? 'cursor-pointer hover:opacity-100 hover:bg-vscode-list-hoverBackground' : 'cursor-not-allowed opacity-30',
    )}
  >
    <Icon size={14} />
  </button>
);

const ContextProgressBar: FC<{ readonly percentage: number }> = ({ percentage }) => (
  <div className="flex-grow h-1.5 bg-vscode-editor-background rounded-full overflow-hidden border border-vscode-editorGroup-border/40">
    <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${percentage}%` }} />
  </div>
);

export const ChatHeader: FC<ChatHeaderProps> = ({
  title,
  tokensIn,
  tokensOut,
  cacheWrites = 0,
  cacheReads = 0,
  totalCost,
  contextTokens,
  contextLimit,
  messages,
  onClose,
  onCompact,
  onExport,
  onDelete,
  onViewRaw,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { showCopy, copy } = useCopyToClipboard();

  const contextPercentage = Math.min(100, Math.round((contextTokens / contextLimit) * 100));

  const handleContainerClick = (e: MouseEvent) => {
    if (e.target instanceof Element && e.target.closest('[data-todo-list]')) return;
    setIsExpanded(!isExpanded);
  };

  const todos = messages.findLast((msg) => msg.toolName === 'update_todo' && msg.todos)?.todos;

  return (
    <div className="py-2 px-3.5 border-b border-vscode-editorGroup-border/30 bg-vscode-sideBar-background shrink-0 select-none">
      <div
        onClick={handleContainerClick}
        className="px-3 pt-2.5 pb-2 flex flex-col gap-1.5 relative z-1 cursor-pointer bg-vscode-input-background hover:bg-vscode-input-background/90 text-vscode-foreground/80 hover:text-vscode-foreground shadow-lg shadow-vscode-sideBar-background/50 rounded-xl border border-[var(--vscode-panel-border)]/50 transition-all duration-200"
      >
        {/* Title Bar */}
        <div className="flex justify-between items-center gap-2">
          <div className="flex items-center grow min-w-0">
            <div className="flex items-center shrink-0 text-vscode-descriptionForeground">
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>
            <div className="flex items-center gap-1.5 ml-1.5 grow min-w-0">
              <span className="font-bold text-xs uppercase tracking-wider text-vscode-descriptionForeground shrink-0">Task:</span>
              <span className="whitespace-nowrap overflow-hidden text-ellipsis text-sm font-medium text-vscode-foreground grow min-w-0">
                {title.trim()}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onClose}
              title="Close task"
              className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-vscode-list-hoverBackground text-vscode-descriptionForeground hover:text-vscode-foreground bg-transparent border-none cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Collapsed State Summary */}
        {!isExpanded && (
          <div className="w-full flex items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex-1 flex items-center gap-2">
              <span className="text-xs text-vscode-descriptionForeground whitespace-nowrap">Context: {contextPercentage}%</span>
              <ContextProgressBar percentage={contextPercentage} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {totalCost > 0 && <span className="text-xs font-mono text-vscode-foreground/80">${totalCost.toFixed(4)}</span>}
              <button
                onClick={onCompact}
                title="Compact context"
                className="p-1 rounded text-vscode-descriptionForeground hover:text-vscode-foreground bg-transparent hover:bg-vscode-list-hoverBackground border-none cursor-pointer flex items-center"
              >
                <FoldVertical size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Expanded Details Table */}
        {isExpanded && (
          <div className="flex flex-col gap-2 pt-0.5" onClick={(e) => e.stopPropagation()}>
            <table className="w-full text-xs text-vscode-descriptionForeground">
              <tbody>
                {/* Context Row */}
                <tr>
                  <th className="font-semibold text-left align-middle w-1 whitespace-nowrap pr-3 pb-2.5">Context</th>
                  <td className="align-middle pb-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-vscode-foreground whitespace-nowrap">
                        {contextTokens.toLocaleString()} / {contextLimit.toLocaleString()} ({contextPercentage}%)
                      </span>
                      <ContextProgressBar percentage={contextPercentage} />
                      <button
                        onClick={onCompact}
                        title="Compact context"
                        className="p-1 rounded text-vscode-descriptionForeground hover:text-vscode-foreground bg-transparent hover:bg-vscode-list-hoverBackground border-none cursor-pointer flex items-center"
                      >
                        <FoldVertical size={14} />
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Tokens Row */}
                <tr>
                  <th className="font-semibold text-left align-middle w-1 whitespace-nowrap pr-3 pb-2.5">Tokens</th>
                  <td className="align-middle pb-2.5 font-mono text-vscode-foreground">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <CloudUpload size={12} className="text-vscode-descriptionForeground" />
                        In: {tokensIn.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <CloudDownload size={12} className="text-vscode-descriptionForeground" />
                        Out: {tokensOut.toLocaleString()}
                      </span>
                    </div>
                  </td>
                </tr>

                {/* Cache Row */}
                {(cacheReads > 0 || cacheWrites > 0) && (
                  <tr>
                    <th className="font-semibold text-left align-middle w-1 whitespace-nowrap pr-3 pb-2.5">Cache</th>
                    <td className="align-middle pb-2.5 font-mono text-vscode-foreground">
                      <div className="flex items-center gap-3">
                        {cacheReads > 0 && (
                          <span className="flex items-center gap-1">
                            <CloudDownload size={12} className="text-vscode-descriptionForeground opacity-60" />
                            Reads: {cacheReads.toLocaleString()}
                          </span>
                        )}
                        {cacheWrites > 0 && (
                          <span className="flex items-center gap-1">
                            <CloudUpload size={12} className="text-vscode-descriptionForeground opacity-60" />
                            Writes: {cacheWrites.toLocaleString()}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}

                {/* Cost & Actions Row */}
                <tr>
                  <th className="font-semibold text-left align-middle w-1 whitespace-nowrap pr-3">API Cost</th>
                  <td className="align-middle font-mono text-vscode-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5">
                        <Coins size={12} className="text-vscode-descriptionForeground" />
                        <span className="text-vscode-editorWarning-foreground font-bold">${(totalCost || 0).toFixed(4)}</span>
                        <span className="text-xs text-vscode-descriptionForeground/60 font-normal">USD</span>
                      </div>
                      <div className="flex flex-row items-center gap-1 select-none -my-1">
                        {onExport && (
                          <IconButton
                            icon={Download}
                            title="Export task messages"
                            onClick={(e) => {
                              e.stopPropagation();
                              onExport();
                            }}
                          />
                        )}
                        <IconButton
                          icon={showCopy ? Check : Copy}
                          title={showCopy ? 'Copied prompt!' : 'Copy prompt'}
                          onClick={(e) => {
                            e.stopPropagation();
                            copy(title);
                          }}
                        />
                        {onDelete && (
                          <IconButton
                            icon={Trash2}
                            title="Delete task"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete();
                            }}
                          />
                        )}
                        {onViewRaw && (
                          <IconButton
                            icon={FileJson}
                            title="View raw task"
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewRaw();
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* TODO List */}
        {todos && todos.length > 0 && <TodoView todos={todos} />}
      </div>
    </div>
  );
};

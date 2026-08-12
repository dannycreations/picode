import { ChevronDown, ChevronRight, CloudDownload, CloudUpload, Coins, FoldVertical, X } from 'lucide-react';
import { useState } from 'react';

import { TodoView } from '@pi-code/webview/components/chat/TodoView';
import { TaskActions } from '@pi-code/webview/components/shared/TaskActions';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC, MouseEvent } from 'react';
import type { ChatMessage, StatsData } from '@pi-code/shared/core/protocol';

interface ChatHeaderProps extends StatsData {
  readonly title: string;
  readonly messages: ChatMessage[];
  readonly onClose: () => void;
  readonly onCompact: () => void;
  readonly onExport?: () => void;
  readonly onDelete?: () => void;
  readonly onViewRaw?: () => void;
}

const ContextProgressBar: FC<{ readonly percentage: number }> = ({ percentage }) => (
  <div className="flex-grow h-1.5 bg-vscode-editor-background rounded-full overflow-hidden border border-vscode-editorGroup-border/40">
    <div className="h-full bg-vscode-charts-blue rounded-full transition-all duration-300" style={{ width: `${percentage}%` }} />
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
        className="px-3 pt-2.5 pb-2 flex flex-col gap-1.5 relative z-1 cursor-pointer bg-vscode-input-background hover:bg-vscode-input-background/90 text-vscode-foreground/80 hover:text-vscode-foreground shadow-lg shadow-vscode-sideBar-background/50 rounded-xl border border-vscode-panel-border/50 transition-all duration-200"
      >
        {/* Title Bar */}
        <div className="flex justify-between items-center gap-2">
          <div className="flex items-center grow min-w-0">
            <div className="flex items-center shrink-0 text-vscode-descriptionForeground">
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </div>
            <div className="flex items-center gap-1.5 ml-1.5 grow min-w-0">
              <span className="font-bold text-xs uppercase tracking-wider text-vscode-descriptionForeground shrink-0">Task:</span>
              <Tooltip content={title.trim()} side="bottom">
                <span className="whitespace-nowrap overflow-hidden text-ellipsis text-sm font-medium text-vscode-foreground grow min-w-0">
                  {title.trim()}
                </span>
              </Tooltip>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
            <Tooltip content="Close task" side="bottom">
              <button onClick={onClose} className="icon-button icon-button-sm">
                <X size={14} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Collapsed State Summary */}
        {!isExpanded && (
          <div className="w-full flex items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex-1 flex items-center gap-2">
              <span className="text-muted whitespace-nowrap">Context: {contextPercentage}%</span>
              <ContextProgressBar percentage={contextPercentage} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {totalCost > 0 && <span className="text-xs font-mono text-vscode-foreground/80">${totalCost.toFixed(4)}</span>}
              <Tooltip content="Compact context">
                <button onClick={onCompact} className="icon-button">
                  <FoldVertical size={14} />
                </button>
              </Tooltip>
            </div>
          </div>
        )}

        {/* Expanded Details Table */}
        {isExpanded && (
          <div className="flex flex-col gap-2 pt-0.5" onClick={(e) => e.stopPropagation()}>
            <table className="w-full text-muted">
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
                      <Tooltip content="Compact context">
                        <button onClick={onCompact} className="icon-button">
                          <FoldVertical size={14} />
                        </button>
                      </Tooltip>
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
                        <span className="text-muted/60 font-normal">USD</span>
                      </div>
                      <TaskActions
                        iconSize={14}
                        buttonClassName="icon-button opacity-80 hover:opacity-100 active:bg-vscode-list-hoverBackground/40 transition-opacity"
                        wrapperClassName="select-none -my-1"
                        copyText={title}
                        onExport={onExport}
                        onDelete={onDelete}
                        onViewRaw={onViewRaw}
                      />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {todos && todos.length > 0 && <TodoView todos={todos} />}
      </div>
    </div>
  );
};

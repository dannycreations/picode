import { cn } from 'cnfast';
import { AlertTriangle, Info, RefreshCw } from 'lucide-react';

import { formatTime } from '@pi-code/webview/components/chat/messages/helpers/common';

import type { FC } from 'react';
import type { ChatMessage } from '@pi-code/shared/core/protocol';

export const ApiRequestMessage: FC<{ readonly message: ChatMessage }> = ({ message }) => {
  const isRunning = message.toolStatus === 'running';
  const isFailed = message.toolStatus === 'denied';

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 text-xs select-none transition-opacity duration-200',
        isRunning ? 'opacity-100' : 'opacity-40 hover:opacity-100',
      )}
    >
      <div className="flex items-center gap-2 text-vscode-foreground whitespace-nowrap">
        {isRunning ? (
          <div className="w-3.5 h-3.5 border-2 border-vscode-focusBorder border-t-transparent rounded-full animate-spin shrink-0" />
        ) : isFailed ? (
          <AlertTriangle size={14} className="text-[var(--vscode-editorError-foreground)] shrink-0" />
        ) : (
          <RefreshCw size={14} className="text-vscode-focusBorder shrink-0" />
        )}
        <span className={cn('font-semibold', isFailed ? 'text-[var(--vscode-editorError-foreground)]' : 'text-vscode-foreground')}>
          {isRunning ? 'API Request...' : isFailed ? 'API Request Failed' : 'API Request'}
        </span>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        {message.cost !== undefined && message.cost > 0 && (
          <span className="text-xs text-vscode-dropdown-foreground border border-vscode-dropdown-border/50 px-1.5 py-0.5 rounded bg-vscode-dropdown-background font-mono">
            ${message.cost.toFixed(4)}
          </span>
        )}
        <span className="text-xs text-vscode-descriptionForeground font-normal">{formatTime(message.ts)}</span>
      </div>
    </div>
  );
};

export const ErrorMessage: FC<{ readonly message: ChatMessage }> = ({ message }) => (
  <div className="p-3 rounded-md bg-[var(--vscode-editorError-background)]/10 border border-[var(--vscode-editorError-foreground)]/30 flex gap-2 text-xs text-[var(--vscode-editorError-foreground)]">
    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
    <div className="flex-1 min-w-0">
      <div className="font-semibold text-sm mb-1 select-none">Execution Error</div>
      <div className="font-mono whitespace-pre-wrap break-all leading-normal text-vscode-foreground select-text">
        {message.errorMessage || message.text}
      </div>
    </div>
  </div>
);

export const InfoMessage: FC<{ readonly message: ChatMessage }> = ({ message }) => (
  <div className="flex items-start justify-between gap-2 text-xs select-none">
    <div className="flex items-start gap-2 text-vscode-foreground min-w-0">
      <Info size={14} className="text-vscode-focusBorder shrink-0 mt-0.5" />
      <span className="font-semibold text-vscode-foreground break-words">{message.text}</span>
    </div>
    <span className="text-xs text-vscode-descriptionForeground font-normal shrink-0 whitespace-nowrap">{formatTime(message.ts)}</span>
  </div>
);

import { cn } from 'cnfast';
import { AlertTriangle, GitCommit, Info, RefreshCw, RotateCcw } from 'lucide-react';

import { formatTime } from '@extension/webview/components/chat/messages/helpers/common';

import type { FC } from 'react';
import type { ChatMessage } from '@extension/types/webview';

export const CheckpointMessage: FC<{
  readonly message: ChatMessage;
  readonly onRestoreCheckpoint: (hash: string) => void;
}> = ({ message, onRestoreCheckpoint }) => {
  const hash = message.checkpointHash || '1a2b3c4';
  return (
    <div className="flex items-center justify-between gap-2 text-xs select-none">
      <div className="flex items-center gap-2 text-vscode-foreground whitespace-nowrap">
        <GitCommit size={14} className="text-vscode-focusBorder shrink-0" />
        <span className="font-bold text-vscode-foreground">Checkpoint saved</span>
        <span className="font-mono bg-vscode-badge-background text-vscode-badge-foreground px-1 py-0.5 rounded text-xs">{hash}</span>
      </div>
      <button
        onClick={() => onRestoreCheckpoint(hash)}
        className="ml-auto text-xs text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground bg-transparent border-none cursor-pointer flex items-center gap-1 font-semibold"
      >
        <RotateCcw size={10} /> Restore
      </button>
    </div>
  );
};

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

export const InfoMessage: FC<{ readonly message: ChatMessage }> = ({ message }) => (
  <div className="flex items-center justify-between gap-2 text-xs select-none">
    <div className="flex items-center gap-2 text-vscode-foreground whitespace-nowrap">
      <Info size={14} className="text-vscode-focusBorder shrink-0" />
      <span className="font-semibold text-vscode-foreground">{message.text}</span>
    </div>
    <span className="text-xs text-vscode-descriptionForeground font-normal ml-auto">{formatTime(message.ts)}</span>
  </div>
);

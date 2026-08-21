import { cn } from 'cnfast';
import { AlertTriangle, Info, RefreshCw } from 'lucide-react';

import { SearchableText } from '@pi-code/webview/components/shared/Highlight';
import { Spinner } from '@pi-code/webview/components/shared/Spinner';
import { formatTime } from '@pi-code/webview/utilities/common';

import type { FC } from 'react';
import type { ChatMessage } from '@pi-code/shared/core/types';
import type { SearchContext } from '@pi-code/webview/components/shared/Highlight';

export const ApiRequestMessage: FC<{ readonly message: ChatMessage }> = ({ message }) => {
  if (message.sender !== 'api_request') return null;

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
          <Spinner className="text-vscode-focusBorder" />
        ) : isFailed ? (
          <AlertTriangle size={14} className="text-vscode-editorError-foreground shrink-0" />
        ) : (
          <RefreshCw size={14} className="text-vscode-focusBorder shrink-0" />
        )}
        <span className={cn('font-semibold', isFailed ? 'text-vscode-editorError-foreground' : 'text-vscode-foreground')}>
          {isRunning ? 'API Request...' : isFailed ? 'API Request Failed' : 'API Request'}
        </span>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        {message.cost !== undefined && message.cost > 0 && (
          <span className="text-xs text-vscode-dropdown-foreground border border-vscode-dropdown-border/50 px-1.5 py-0.5 rounded bg-vscode-dropdown-background font-mono">
            ${message.cost.toFixed(4)}
          </span>
        )}
        <span className="text-muted font-normal">{formatTime(message.ts)}</span>
      </div>
    </div>
  );
};

export const ErrorMessage: FC<{ readonly message: ChatMessage; readonly search?: SearchContext }> = ({ message, search }) => {
  if (message.sender !== 'error') return null;

  return (
    <div className="p-3 rounded-md bg-vscode-editorError-background/10 border border-vscode-editorError-foreground/30 flex gap-2 text-xs text-vscode-editorError-foreground">
      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm mb-1 select-none">Execution Error</div>
        <div className="font-mono whitespace-pre-wrap break-all leading-normal text-vscode-foreground select-text">
          <SearchableText text={message.errorMessage || message.text} search={search} />
        </div>
      </div>
    </div>
  );
};

export const InfoMessage: FC<{ readonly message: ChatMessage; readonly search?: SearchContext }> = ({ message, search }) => {
  return (
    <div className="flex items-start justify-between gap-2 text-xs select-none">
      <div className="flex items-start gap-2 text-vscode-foreground min-w-0">
        <Info size={14} className="text-vscode-focusBorder shrink-0 mt-0.5" />
        <span className="font-semibold text-vscode-foreground break-words">
          <SearchableText text={message.text} search={search} />
        </span>
      </div>
      <span className="text-muted font-normal shrink-0 whitespace-nowrap">{formatTime(message.ts)}</span>
    </div>
  );
};

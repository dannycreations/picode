import { cn } from 'cn';
import { AlertTriangle, ChevronUp, Info, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { Accordion } from '@pi-code/webview/components/shared/Accordion';
import { SearchableText } from '@pi-code/webview/components/shared/Highlight';
import { Spinner } from '@pi-code/webview/components/shared/Spinner';
import { formatTime } from '@pi-code/webview/utilities/common';

import type { FC } from 'react';
import type { ChatMessage } from '@pi-code/shared/core/types';
import type { SearchContext } from '@pi-code/webview/components/shared/Highlight';

export const ApiRequestMessage: FC<{ readonly message: ChatMessage }> = ({ message }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  if (message.sender !== 'api_request') return null;

  const isRunning = message.toolStatus === 'running';
  const error = message.toolStatus === 'denied' ? message.errorMessage : undefined;

  return (
    <div>
      <div
        className={cn(
          'flex items-center justify-between gap-2 text-xs select-none transition-opacity duration-200',
          isRunning ? 'opacity-100' : 'opacity-40 hover:opacity-100',
        )}
      >
        <div
          className={cn('flex items-center gap-2 whitespace-nowrap', error && 'cursor-pointer')}
          onClick={error ? () => setIsExpanded(!isExpanded) : undefined}
        >
          {isRunning ? (
            <Spinner className="text-vscode-focusBorder" />
          ) : error ? (
            <AlertTriangle size={14} className="text-vscode-editorError-foreground shrink-0" />
          ) : (
            <RefreshCw size={14} className="text-vscode-focusBorder shrink-0" />
          )}
          <span className={cn('font-semibold', error ? 'text-vscode-editorError-foreground' : 'text-vscode-foreground')}>
            {isRunning ? 'API Request...' : error ? 'API Request Failed' : 'API Request'}
          </span>
          {error && (
            <ChevronUp
              size={14}
              className={cn('text-vscode-editorError-foreground transition-transform duration-200', !isExpanded && 'rotate-180')}
            />
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {message.cost !== undefined && message.cost > 0 && (
            <span className="text-xs text-vscode-dropdown-foreground border border-vscode-dropdown-border/50 px-1.5 py-0.5 rounded bg-vscode-dropdown-background font-mono">
              ${message.cost.toFixed(4)}
            </span>
          )}
          <span className="text-muted font-normal">{formatTime(message.timestamp)}</span>
        </div>
      </div>
      <Accordion open={error !== undefined && isExpanded}>
        <div className="mt-1 ml-6 border-l border-vscode-descriptionForeground/20 pl-4 font-mono text-xs break-all whitespace-pre-wrap leading-normal text-vscode-editorError-foreground select-text">
          {error}
        </div>
      </Accordion>
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
      <span className="text-muted font-normal shrink-0 whitespace-nowrap">{formatTime(message.timestamp)}</span>
    </div>
  );
};

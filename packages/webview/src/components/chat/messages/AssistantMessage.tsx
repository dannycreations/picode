import { cn } from 'cnfast';
import { ChevronUp, Lightbulb, MessageCircle } from 'lucide-react';
import { useState } from 'react';

import { Markdown } from '@pi-code/webview/components/chat/markdown/Markdown';
import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { Spinner } from '@pi-code/webview/components/shared/Spinner';

import type { FC } from 'react';
import type { ChatMessage } from '@pi-code/shared/core/types';

interface AssistantMessageProps {
  readonly message: ChatMessage;
}

export const AssistantMessage: FC<AssistantMessageProps> = ({ message }) => {
  const [isReasoningExpanded, setIsReasoningExpanded] = useState(false);

  const reasoning = message.reasoning?.trim() ?? '';
  const hasReasoning = reasoning !== '';
  const hasText = message.text.trim() !== '';

  return (
    <div className="group flex flex-col gap-1.5">
      {hasReasoning && (
        <div className={cn('flex flex-col gap-1.5', hasText && 'mb-2')}>
          <MessageHeader
            icon={
              message.toolStatus === 'running' && !hasText ? (
                <Spinner className="text-vscode-focusBorder" />
              ) : (
                <Lightbulb size={14} className="text-vscode-focusBorder shrink-0" />
              )
            }
            title="Pi Thinking"
            timestamp={message.ts}
            onClick={() => setIsReasoningExpanded(!isReasoningExpanded)}
          >
            <ChevronUp size={14} className={cn('transition-transform duration-200', !isReasoningExpanded && 'rotate-180')} />
          </MessageHeader>
          {isReasoningExpanded && (
            <div className="ml-6 border-l border-vscode-descriptionForeground/20 pl-4 pb-1 text-muted whitespace-pre-wrap break-words leading-relaxed select-text">
              {reasoning}
            </div>
          )}
        </div>
      )}

      {hasText && (
        <div className="flex flex-col gap-1.5">
          <MessageHeader
            icon={
              message.toolStatus === 'running' ? (
                <Spinner className="text-vscode-focusBorder" />
              ) : (
                <MessageCircle size={14} className="text-vscode-focusBorder shrink-0" />
              )
            }
            title="Pi Said"
            timestamp={message.ts}
          />
          <div className="ml-6 text-sm leading-normal text-vscode-foreground select-text">
            <Markdown markdown={message.text} />
          </div>
        </div>
      )}
    </div>
  );
};

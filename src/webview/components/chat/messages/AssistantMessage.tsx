import { ChevronUp, Lightbulb, MessageCircle } from 'lucide-react';
import { useState } from 'react';

import { Markdown } from '@extension/webview/components/chat/markdown/Markdown';
import { MessageHeader } from '@extension/webview/components/chat/messages/MessageHeader';

import type { FC } from 'react';
import type { ChatMessage } from '@extension/types/webview';

export const AssistantMessage: FC<{ readonly message: ChatMessage }> = ({ message }) => {
  const [isReasoningExpanded, setIsReasoningExpanded] = useState(false);

  const hasReasoning = !!message.reasoning && message.reasoning.trim() !== '';
  const hasText = !!message.text && message.text.trim() !== '';

  if (!hasReasoning && !hasText) return null;

  return (
    <div className="group flex flex-col gap-1.5">
      {hasReasoning && (
        <div className={`flex flex-col gap-1.5 ${hasText ? 'mb-2' : ''}`}>
          <MessageHeader
            icon={<Lightbulb size={14} className="text-vscode-focusBorder shrink-0" />}
            title="Pi Thinking"
            timestamp={message.ts}
            onClick={() => setIsReasoningExpanded(!isReasoningExpanded)}
          >
            <ChevronUp size={14} className={`transition-transform duration-200 ${!isReasoningExpanded ? 'rotate-180' : ''}`} />
          </MessageHeader>
          {isReasoningExpanded && (
            <div className="ml-6 border-l border-vscode-descriptionForeground/20 pl-4 pb-1 text-vscode-descriptionForeground text-xs whitespace-pre-wrap leading-relaxed select-text">
              {message.reasoning?.trim()}
            </div>
          )}
        </div>
      )}

      {hasText && (
        <div className="flex flex-col gap-1.5">
          <MessageHeader icon={<MessageCircle size={14} className="text-vscode-focusBorder shrink-0" />} title="Pi Said" timestamp={message.ts} />
          <div className="ml-6 text-sm leading-normal text-vscode-foreground select-text">
            <Markdown markdown={message.text} />
          </div>
        </div>
      )}
    </div>
  );
};

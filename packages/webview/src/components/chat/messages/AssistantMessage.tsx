import { cn } from 'cnfast';
import { ChevronUp, Lightbulb, MessageCircle } from 'lucide-react';
import { useState } from 'react';

import { Markdown } from '@pi-code/webview/components/chat/markdown/Markdown';
import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { Accordion } from '@pi-code/webview/components/shared/Accordion';
import { locateOccurrences, SearchableText } from '@pi-code/webview/components/shared/Highlight';
import { Spinner } from '@pi-code/webview/components/shared/Spinner';

import type { FC } from 'react';
import type { ChatMessage } from '@pi-code/shared/core/types';
import type { SearchContext } from '@pi-code/webview/components/shared/Highlight';

interface AssistantMessageProps {
  readonly message: ChatMessage;
  readonly search?: SearchContext;
}

export const AssistantMessage: FC<AssistantMessageProps> = ({ message, search }) => {
  const [isReasoningExpanded, setIsReasoningExpanded] = useState(false);

  if (message.sender !== 'assistant') return null;

  const reasoning = message.reasoning?.trim() ?? '';
  const hasReasoning = reasoning !== '';
  const hasText = message.text.trim() !== '';
  const { count: reasoningCount, active: reasoningActive } = locateOccurrences(reasoning, search);
  // Reveal the reasoning block when the active match lives inside it, so the
  // highlight is visible; collapse it again once the match moves elsewhere
  // (unless the user opened it manually).
  const showReasoning = isReasoningExpanded || reasoningActive !== -1;

  return (
    <div className="group flex flex-col gap-1.5">
      {hasReasoning && (
        <div className={cn('flex flex-col', hasText && 'mb-2')}>
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
            <ChevronUp size={14} className={cn('transition-transform duration-200', !showReasoning && 'rotate-180')} />
          </MessageHeader>
          <Accordion open={showReasoning}>
            <div className="ml-6 border-l border-vscode-descriptionForeground/20 pl-4 pb-1 text-muted whitespace-pre-wrap break-words leading-relaxed select-text">
              <SearchableText text={reasoning} search={search} />
            </div>
          </Accordion>
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
            <Markdown
              markdown={message.text}
              search={
                search
                  ? { query: search.query, globalOffset: search.globalOffset + (hasReasoning ? reasoningCount : 0), activeIndex: search.activeIndex }
                  : undefined
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};

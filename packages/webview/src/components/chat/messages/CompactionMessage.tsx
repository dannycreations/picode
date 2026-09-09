import { cn } from 'cn';
import { ChevronUp, Lightbulb } from 'lucide-react';
import { useState } from 'react';

import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { Accordion } from '@pi-code/webview/components/shared/Accordion';
import { SearchableText } from '@pi-code/webview/components/shared/Highlight';

import type { FC } from 'react';
import type { ChatMessage } from '@pi-code/shared/core/types';
import type { SearchContext } from '@pi-code/webview/components/shared/Highlight';

interface CompactionMessageProps {
  readonly message: ChatMessage;
  readonly search?: SearchContext;
}

export const CompactionMessage: FC<CompactionMessageProps> = ({ message, search }) => {
  if (message.sender !== 'compaction') return null;

  const summary = message.text?.trim() ?? '';
  const hasSummary = summary !== '';
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="group flex flex-col gap-1.5">
      {hasSummary && (
        <div>
          <MessageHeader
            icon={<Lightbulb size={14} className="text-vscode-focusBorder shrink-0" />}
            title="Compaction"
            timestamp={message.timestamp}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <ChevronUp size={14} className={cn('transition-transform duration-200', !isExpanded && 'rotate-180')} />
          </MessageHeader>
          <Accordion open={isExpanded}>
            <div className="ml-6 border-l border-vscode-descriptionForeground/20 pl-4 pb-1 text-muted whitespace-pre-wrap break-words leading-relaxed select-text max-h-60 overflow-y-auto">
              <SearchableText text={summary} search={search} />
            </div>
          </Accordion>
        </div>
      )}
    </div>
  );
};

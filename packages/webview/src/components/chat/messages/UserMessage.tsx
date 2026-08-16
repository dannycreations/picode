import { User } from 'lucide-react';

import { findOccurrences } from '@pi-code/shared/utilities/common';
import { splitCommand } from '@pi-code/webview/components/chat/helpers/command';
import { localActiveIndex } from '@pi-code/webview/components/chat/helpers/search';
import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { Highlight } from '@pi-code/webview/components/shared/Highlight';
import { ImageThumb } from '@pi-code/webview/components/shared/ImageThumb';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC } from 'react';
import type { CommandItem } from '@pi-code/shared/core/protocol';
import type { ChatMessage } from '@pi-code/shared/core/types';
import type { SearchContext } from '@pi-code/webview/components/shared/Highlight';

interface UserMessageProps {
  readonly message: ChatMessage;
  readonly commands: readonly CommandItem[];
  readonly search?: SearchContext;
}

export const UserMessage: FC<UserMessageProps> = ({ message, commands, search }) => {
  const text = message.text.trim();
  const highlight = splitCommand(text, commands);
  const query = search?.query ?? '';
  const textCount = findOccurrences(text, query).length;
  const active = search ? localActiveIndex(search.globalOffset, textCount, search.activeIndex) : -1;

  return (
    <div className="group flex flex-col gap-1">
      <MessageHeader icon={<User size={14} className="text-vscode-focusBorder shrink-0" />} title="You Said" timestamp={message.ts} />
      <div className="message-surface whitespace-pre-wrap leading-normal select-text">
        {search ? (
          <Highlight text={text} query={query} activeOccurrence={active} />
        ) : highlight ? (
          <>
            <Tooltip content="Loaded on request">
              <span className="command-chip">{highlight.command}</span>
            </Tooltip>
            {highlight.rest}
          </>
        ) : (
          text
        )}
        {message.images && message.images.length > 0 && (
          <div className="image-row">
            {message.images.map((img, idx) => (
              <ImageThumb key={idx} url={img} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

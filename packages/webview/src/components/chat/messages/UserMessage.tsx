import { User } from 'lucide-react';

import { splitCommand } from '@pi-code/webview/components/chat/helpers/command';
import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { ImageThumb } from '@pi-code/webview/components/shared/ImageThumb';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC } from 'react';
import type { ChatMessage, CommandItem } from '@pi-code/shared/core/protocol';

interface UserMessageProps {
  readonly message: ChatMessage;
  readonly commands: readonly CommandItem[];
}

export const UserMessage: FC<UserMessageProps> = ({ message, commands }) => {
  const text = message.text.trim();
  const highlight = splitCommand(text, commands);

  return (
    <div className="group flex flex-col gap-1">
      <MessageHeader icon={<User size={14} className="text-vscode-focusBorder shrink-0" />} title="You Said" timestamp={message.ts} />
      <div className="message-surface whitespace-pre-wrap leading-normal select-text">
        {highlight ? (
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

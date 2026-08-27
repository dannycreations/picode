import { Pencil, Trash2, User } from 'lucide-react';
import { Fragment, useState } from 'react';

import { splitTokenSegments } from '@pi-code/webview/components/chat/helpers/highlight';
import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { SearchableText } from '@pi-code/webview/components/shared/Highlight';
import { ImageThumbRow } from '@pi-code/webview/components/shared/ImageThumb';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { FC } from 'react';
import type { CommandItem } from '@pi-code/shared/core/protocol';
import type { ChatMessage, QueueChatMessage } from '@pi-code/shared/core/types';
import type { SearchContext } from '@pi-code/webview/components/shared/Highlight';

interface TokenizedTextProps {
  readonly text: string;
  readonly commands: readonly CommandItem[];
  readonly search?: SearchContext;
}

export const TokenizedText: FC<TokenizedTextProps> = ({ text, commands, search }) => {
  const body = text.trim();

  if (search) {
    return <SearchableText text={body} search={search} />;
  }

  return (
    <>
      {splitTokenSegments(body, commands).map((segment, index) =>
        segment.highlighted ? (
          <Tooltip key={index} content="Loaded on request">
            <span className="command-chip">{segment.text}</span>
          </Tooltip>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
};

interface QueueMessageProps {
  readonly message: QueueChatMessage;
  readonly commands: readonly CommandItem[];
  readonly search?: SearchContext;
}

export const QueueMessage: FC<QueueMessageProps> = ({ message, commands, search }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);

  const handleSave = (): void => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    useChatStore.getState().send({ type: 'edit_reply_queue', id: message.id, text: trimmed });
    setIsEditing(false);
  };

  const handleRemove = (): void => {
    useChatStore.getState().send({ type: 'remove_from_reply_queue', id: message.id });
  };

  return (
    <div className="group flex flex-col gap-1">
      <MessageHeader icon={<User size={14} className="text-vscode-focusBorder shrink-0" />} title="You Said" timestamp={message.ts}>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-vscode-charts-orange px-1.5 py-0.5 rounded border border-vscode-charts-orange/30 bg-vscode-charts-orange/10 ml-1.5 select-none">
          Queued
        </span>
      </MessageHeader>

      {isEditing ? (
        <div className="message-surface flex flex-col gap-2">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full min-h-[60px] p-2 rounded border border-vscode-focusBorder bg-vscode-input-background text-vscode-input-foreground outline-none resize-y font-sans text-sm"
          />
          <div className="flex gap-2 justify-end text-xs">
            <button onClick={handleSave} className="action-button px-2.5 py-1">
              Save
            </button>
            <button onClick={() => setIsEditing(false)} className="action-button action-button-secondary px-2.5 py-1">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="message-surface whitespace-pre-wrap leading-normal select-text">
          <TokenizedText text={message.text} commands={commands} search={search} />
          <ImageThumbRow images={message.images ?? []} />
          <div className="flex justify-end gap-3.5 mt-3 pt-2.5 border-t border-vscode-panel-border/50 text-xs select-none">
            <button
              onClick={() => {
                setIsEditing(true);
                setEditText(message.text);
              }}
              className="text-button text-vscode-textLink-foreground hover:underline"
            >
              <Pencil size={12} /> Edit
            </button>
            <button onClick={handleRemove} className="text-button text-vscode-errorForeground hover:underline">
              <Trash2 size={12} /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface UserMessageProps {
  readonly message: ChatMessage;
  readonly commands: readonly CommandItem[];
  readonly search?: SearchContext;
}

export const UserMessage: FC<UserMessageProps> = ({ message, commands, search }) => {
  if (message.sender !== 'user') return null;

  return (
    <div className="group flex flex-col gap-1">
      <MessageHeader icon={<User size={14} className="text-vscode-focusBorder shrink-0" />} title="You Said" timestamp={message.ts} />
      <div className="message-surface whitespace-pre-wrap leading-normal select-text">
        <TokenizedText text={message.text} commands={commands} search={search} />
        <ImageThumbRow images={message.images ?? []} />
      </div>
    </div>
  );
};

import { Pencil, Trash2, User } from 'lucide-react';
import { useState } from 'react';

import { findOccurrences } from '@pi-code/shared/utilities/common';
import { localActiveIndex } from '@pi-code/webview/components/chat/helpers/search';
import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { Highlight } from '@pi-code/webview/components/shared/Highlight';
import { ImageThumb } from '@pi-code/webview/components/shared/ImageThumb';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { FC } from 'react';
import type { ChatMessage } from '@pi-code/shared/core/types';
import type { SearchContext } from '@pi-code/webview/components/shared/Highlight';

interface QueueMessageProps {
  readonly message: ChatMessage;
  readonly search?: SearchContext;
}

export const QueueMessage: FC<QueueMessageProps> = ({ message, search }) => {
  if (message.sender !== 'queue') return null;

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);

  const query = search?.query ?? '';
  const textCount = findOccurrences(message.text, query).length;
  const active = search ? localActiveIndex(search.globalOffset, textCount, search.activeIndex) : -1;

  const handleSave = (): void => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    useChatStore.getState().editReplyQueue(message.id, trimmed);
    setIsEditing(false);
  };

  const handleRemove = (): void => {
    useChatStore.getState().removeFromReplyQueue(message.id);
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
          <Highlight text={message.text.trim()} query={query} activeOccurrence={active} />
          {message.images && message.images.length > 0 && (
            <div className="image-row">
              {message.images.map((img, idx) => (
                <ImageThumb key={idx} url={img} />
              ))}
            </div>
          )}
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

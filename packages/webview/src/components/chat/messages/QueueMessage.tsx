import { Pencil, Trash2, User } from 'lucide-react';
import { useState } from 'react';

import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { vscode } from '@pi-code/webview/utilities/vscode';

import type { FC } from 'react';
import type { ChatMessage } from '@pi-code/shared/core/protocol';

interface QueueMessageProps {
  readonly message: ChatMessage;
}

export const QueueMessage: FC<QueueMessageProps> = ({ message }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);

  const handleSave = (): void => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    vscode?.postMessage({
      type: 'edit_reply_queue',
      id: message.id,
      text: trimmed,
    });
    setIsEditing(false);
  };

  const handleRemove = (): void => {
    vscode?.postMessage({
      type: 'remove_from_reply_queue',
      id: message.id,
    });
  };

  return (
    <div className="group flex flex-col gap-1">
      <MessageHeader icon={<User size={14} className="text-vscode-focusBorder shrink-0" />} title="You Said" timestamp={message.ts}>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--vscode-charts-orange,#d16d13)] px-1.5 py-0.5 rounded border border-[var(--vscode-charts-orange,#d16d13)]/30 bg-[var(--vscode-charts-orange,#d16d13)]/10 ml-1.5 select-none">
          Queued
        </span>
      </MessageHeader>

      {isEditing ? (
        <div className="ml-6 border border-vscode-editorGroup-border rounded bg-vscode-editor-background text-vscode-editor-foreground p-3 text-sm flex flex-col gap-2">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full min-h-[60px] p-2 rounded border border-vscode-focusBorder bg-vscode-input-background text-vscode-input-foreground outline-none resize-y font-sans text-sm"
          />
          <div className="flex gap-2 justify-end text-xs">
            <button
              onClick={handleSave}
              className="px-2.5 py-1 rounded bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] font-semibold border-none cursor-pointer"
            >
              Save
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="px-2.5 py-1 rounded bg-[var(--vscode-button-secondaryBackground,#3a3d41)] text-[var(--vscode-button-secondaryForeground,#ffffff)] hover:bg-[var(--vscode-button-secondaryHoverBackground,#45494e)] font-semibold border-none cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="ml-6 border border-vscode-editorGroup-border rounded bg-vscode-editor-background text-vscode-editor-foreground p-3 text-sm whitespace-pre-wrap leading-normal select-text">
          {message.text.trim()}
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[var(--vscode-panel-border)]">
              {message.images.map((img, idx) => (
                <Tooltip key={idx} content="Click to view image">
                  <div
                    onClick={() => vscode?.postMessage({ type: 'open_image', dataUrl: img })}
                    className="relative w-10 h-10 rounded border border-[var(--vscode-panel-border)] overflow-hidden cursor-pointer hover:opacity-80"
                  >
                    <img src={img} alt="attachment" className="w-full h-full object-cover" />
                  </div>
                </Tooltip>
              ))}
            </div>
          )}
          <div className="flex gap-3.5 mt-3 pt-2.5 border-t border-[var(--vscode-panel-border)]/50 text-xs select-none">
            <button
              onClick={() => {
                setIsEditing(true);
                setEditText(message.text);
              }}
              className="flex items-center gap-1.5 cursor-pointer bg-transparent border-none text-[var(--vscode-textLink-foreground)] hover:underline p-0"
            >
              <Pencil size={12} /> Edit
            </button>
            <button
              onClick={handleRemove}
              className="flex items-center gap-1.5 cursor-pointer bg-transparent border-none text-[var(--vscode-errorForeground,#f48771)] hover:underline p-0"
            >
              <Trash2 size={12} /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

import { User } from 'lucide-react';

import { splitCommand } from '@pi-code/webview/components/chat/helpers/command';
import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { vscode } from '@pi-code/webview/utilities/vscode';

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
      <div className="ml-6 border border-vscode-editorGroup-border rounded bg-vscode-editor-background text-vscode-editor-foreground p-3 text-sm whitespace-pre-wrap leading-normal select-text">
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
      </div>
    </div>
  );
};

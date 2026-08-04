import { User } from 'lucide-react';

import { MessageHeader } from '@extension/webview/components/chat/messages/MessageHeader';
import { vscode } from '@webview/utilities/vscode';

import type { FC } from 'react';
import type { ChatMessage } from '@extension/types/webview';

export const UserMessage: FC<{ readonly message: ChatMessage }> = ({ message }) => (
  <div className="group flex flex-col gap-1">
    <MessageHeader icon={<User size={14} className="text-vscode-focusBorder shrink-0" />} title="You Said" timestamp={message.ts} />
    <div className="ml-6 border border-vscode-editorGroup-border rounded bg-vscode-editor-background text-vscode-editor-foreground p-3 text-sm whitespace-pre-wrap leading-normal select-text">
      {message.text.trim()}
      {message.images && message.images.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[var(--vscode-panel-border)]">
          {message.images.map((img, idx) => (
            <div
              key={idx}
              onClick={() => vscode?.postMessage({ type: 'open_image', dataUrl: img })}
              className="relative w-10 h-10 rounded border border-[var(--vscode-panel-border)] overflow-hidden cursor-pointer hover:opacity-80"
              title="Click to view image"
            >
              <img src={img} alt="attachment" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);

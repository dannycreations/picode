import { cn } from 'cnfast';
import { Image as ImageIcon, Send } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

import { logger } from '@pi-code/shared/core/logger';
import { CommandMenu } from '@pi-code/webview/components/chat/CommandMenu';
import { splitCommand } from '@pi-code/webview/components/chat/helpers/command';
import { useChatCommand } from '@pi-code/webview/components/chat/hooks/useChatCommand';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { readFileAsDataUrl } from '@pi-code/webview/utilities/common';

import type { ChangeEvent, ClipboardEvent, FC, KeyboardEvent, RefObject } from 'react';
import type { CommandItem } from '@pi-code/shared/core/protocol';

interface ChatInputProps {
  readonly inputValue: string;
  readonly setInputValue: (val: string) => void;
  readonly onSend: (text: string, images: string[]) => void;
  readonly sendingDisabled: boolean;
  readonly placeholderText: string;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly commands: readonly CommandItem[];
}

const AttachedImagesPreview: FC<{
  readonly images: string[];
  readonly onRemove: (index: number) => void;
}> = ({ images, onRemove }) => {
  if (images.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2 mt-1">
      {images.map((img, idx) => (
        <div key={idx} className="relative w-10 h-10 rounded border border-vscode-panel-border overflow-hidden group">
          <img src={img} alt="attachment" className="w-full h-full object-cover" />
          <Tooltip content="Remove attachment">
            <button
              onClick={() => onRemove(idx)}
              className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-black/70 hover:bg-black text-white text-xs rounded-full flex items-center justify-center border-none cursor-pointer"
            >
              ×
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  );
};

export const ChatInput: FC<ChatInputProps> = ({ inputValue, setInputValue, onSend, sendingDisabled, placeholderText, textareaRef, commands }) => {
  const [isFocused, setIsFocused] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const matchRef = useRef<HTMLDivElement>(null);

  const command = useChatCommand({ commands, value: inputValue, setValue: setInputValue, textareaRef });
  const match = useMemo(() => splitCommand(inputValue, commands), [inputValue, commands]);

  const handleSend = () => {
    if ((inputValue.trim() || selectedImages.length > 0) && !sendingDisabled) {
      onSend(inputValue, selectedImages);
      setInputValue('');
      setSelectedImages([]);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // The picker owns navigation and acceptance keys while it is open.
    if (command.handleKeyDown(e)) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    command.handleChange(e);
  };

  const handleAttachImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setSelectedImages((prev) => [...prev, dataUrl]);
      } catch (err) {
        logger.error('Failed to attach image:', err);
      }
    }
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.includes('image')) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          try {
            const dataUrl = await readFileAsDataUrl(file);
            setSelectedImages((prev) => [...prev, dataUrl]);
          } catch (err) {
            logger.error('Failed to paste image:', err);
          }
        }
      }
    }
  };

  const isSendButtonActive = (inputValue.trim().length > 0 || selectedImages.length > 0) && !sendingDisabled;

  return (
    <div className={cn('relative flex flex-col px-3.5 pt-2 pb-1 outline-none w-full box-border bg-vscode-sideBar-background shrink-0')}>
      {command.isOpen && (
        <CommandMenu commands={command.matches} selectedIndex={command.selectedIndex} onSelect={command.select} onHover={command.setSelectedIndex} />
      )}

      <AttachedImagesPreview images={selectedImages} onRemove={(idx) => setSelectedImages((prev) => prev.filter((_, i) => i !== idx))} />

      <div
        className={cn(
          'relative flex flex-col rounded border transition-all duration-150',
          isFocused ? 'border-vscode-focusBorder ring-1 ring-vscode-focusBorder' : 'border-vscode-input-border bg-vscode-input-background',
        )}
      >
        <div className="relative flex">
          <div
            ref={matchRef}
            aria-hidden="true"
            className={cn(
              'chat-input-text',
              'absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-transparent pointer-events-none select-none',
            )}
          >
            {match ? (
              <>
                <mark className="command-match">{match.command}</mark>
                {match.rest}
              </>
            ) : (
              inputValue
            )}
            {/* A block box collapses its trailing newline; pad it so the mirror keeps the textarea's height. */}
            {inputValue.endsWith('\n') ? '\n' : ''}
          </div>

          <TextareaAutosize
            ref={textareaRef}
            value={inputValue}
            onChange={handleChange}
            onFocus={() => {
              setIsFocused(true);
            }}
            onBlur={() => {
              setIsFocused(false);
              command.close();
            }}
            onKeyDown={handleKeyDown}
            onSelect={command.syncCaret}
            onPaste={handlePaste}
            onScroll={(e) => {
              if (matchRef.current) matchRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            placeholder={placeholderText}
            disabled={sendingDisabled}
            minRows={3}
            maxRows={6}
            className={cn(
              'chat-input-text',
              'relative w-full bg-transparent text-vscode-input-foreground border-none outline-none resize-none z-10 scrollbar-none',
            )}
          />
        </div>

        <div className="flex justify-between items-center px-2.5 pb-2 pt-1 z-20 pointer-events-auto">
          <div className="flex items-center gap-1.5 ml-auto">
            <input type="file" ref={fileInputRef} onChange={handleAttachImage} accept="image/*" className="hidden" />
            <Tooltip content="Add image attachment">
              <button onClick={() => fileInputRef.current?.click()} className="icon-button">
                <ImageIcon size={14} />
              </button>
            </Tooltip>

            <Tooltip content="Send message (Enter)">
              <button
                onClick={handleSend}
                disabled={!isSendButtonActive}
                className={cn('action-button p-1.5', isSendButtonActive ? '' : 'action-button-secondary opacity-40 cursor-not-allowed')}
              >
                <Send size={13} fill="currentColor" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
};

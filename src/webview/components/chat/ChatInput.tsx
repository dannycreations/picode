import { cn } from 'cnfast';
import { Image as ImageIcon, Send } from 'lucide-react';
import { useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

import { readFileAsDataUrl } from '@extension/webview/components/chat/helpers/common';

import type { ChangeEvent, ClipboardEvent, FC, KeyboardEvent, RefObject } from 'react';

export interface ChatInputProps {
  readonly inputValue: string;
  readonly setInputValue: (val: string) => void;
  readonly onSend: (text: string, images: string[]) => void;
  readonly sendingDisabled: boolean;
  readonly placeholderText?: string;
  readonly className?: string;
  readonly textareaRef?: RefObject<HTMLTextAreaElement | null>;
}

const AttachedImagesPreview: FC<{
  readonly images: string[];
  readonly onRemove: (index: number) => void;
}> = ({ images, onRemove }) => {
  if (images.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2 mt-1">
      {images.map((img, idx) => (
        <div key={idx} className="relative w-10 h-10 rounded border border-[var(--vscode-panel-border)] overflow-hidden group">
          <img src={img} alt="attachment" className="w-full h-full object-cover" />
          <button
            onClick={() => onRemove(idx)}
            className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-black/70 hover:bg-black text-white text-xs rounded-full flex items-center justify-center border-none cursor-pointer"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

export const ChatInput: FC<ChatInputProps> = ({
  inputValue,
  setInputValue,
  onSend,
  sendingDisabled,
  placeholderText = 'Ask a question or type a command...',
  className = '',
  textareaRef,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if ((inputValue.trim() || selectedImages.length > 0) && !sendingDisabled) {
      onSend(inputValue, selectedImages);
      setInputValue('');
      setSelectedImages([]);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAttachImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        setSelectedImages((prev) => [...prev, dataUrl]);
      } catch (err) {
        console.error('Failed to attach image:', err);
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
            console.error('Failed to paste image:', err);
          }
        }
      }
    }
  };

  const isSendButtonActive = (inputValue.trim().length > 0 || selectedImages.length > 0) && !sendingDisabled;

  return (
    <div
      className={cn('relative flex flex-col px-3.5 pb-1 outline-none w-full box-border bg-[var(--vscode-sideBar-background)] shrink-0', className)}
    >
      <AttachedImagesPreview images={selectedImages} onRemove={(idx) => setSelectedImages((prev) => prev.filter((_, i) => i !== idx))} />

      <div
        className={cn(
          'relative flex flex-col rounded border transition-all duration-150',
          isFocused
            ? 'border-[var(--vscode-focusBorder)] ring-1 ring-[var(--vscode-focusBorder)]'
            : 'border-[var(--vscode-input-border,transparent)] bg-[var(--vscode-input-background)]',
        )}
      >
        <TextareaAutosize
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholderText}
          disabled={sendingDisabled}
          minRows={3}
          maxRows={6}
          className="w-full p-2.5 pb-1 bg-transparent text-[var(--vscode-input-foreground)] font-sans text-sm leading-normal border-none outline-none resize-none z-10 box-border scrollbar-none"
        />

        <div className="flex justify-between items-center px-2.5 pb-2 pt-1 z-20 pointer-events-auto">
          <div />
          <div className="flex items-center gap-1.5">
            <input type="file" ref={fileInputRef} onChange={handleAttachImage} accept="image/*" className="hidden" />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Add Image Attachment"
              className="p-1.5 rounded hover:bg-[var(--vscode-list-hoverBackground)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] bg-transparent border-none cursor-pointer transition-colors"
            >
              <ImageIcon size={14} />
            </button>

            <button
              onClick={handleSend}
              disabled={!isSendButtonActive}
              className={cn(
                'p-1.5 rounded border-none cursor-pointer transition-colors',
                isSendButtonActive
                  ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]'
                  : 'bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] opacity-40 cursor-not-allowed',
              )}
            >
              <Send size={13} fill="currentColor" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

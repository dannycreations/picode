import { Image as ImageIcon, Send } from 'lucide-react';
import { useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

import type { ChangeEvent, ClipboardEvent, FC, KeyboardEvent, RefObject } from 'react';

interface ChatTextAreaProps {
  readonly inputValue: string;
  readonly setInputValue: (val: string) => void;
  readonly onSend: (text: string, images: string[]) => void;
  readonly sendingDisabled: boolean;
  readonly placeholderText?: string;
  readonly className?: string;
  readonly textareaRef?: RefObject<HTMLTextAreaElement | null>;
}

export const ChatTextArea: FC<ChatTextAreaProps> = ({
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

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if ((inputValue.trim() || selectedImages.length > 0) && !sendingDisabled) {
      onSend(inputValue, selectedImages);
      setInputValue('');
      setSelectedImages([]);
    }
  };

  const handleAttachImage = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setSelectedImages((prev) => [...prev, event.target!.result as string]);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = (event) => {
            if (event.target?.result) {
              setSelectedImages((prev) => [...prev, event.target!.result as string]);
            }
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const removeImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className={`relative flex flex-col px-3.5 pb-1 outline-none w-full box-border bg-[var(--vscode-sideBar-background)] shrink-0 ${className}`}>
      {/* Attached Images Preview */}
      {selectedImages.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 mt-1">
          {selectedImages.map((img, idx) => (
            <div key={idx} className="relative w-10 h-10 rounded border border-[var(--vscode-panel-border)] overflow-hidden group">
              <img src={img} alt="attachment" className="w-full h-full object-cover" />
              <button
                onClick={() => removeImage(idx)}
                className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-black/70 hover:bg-black text-white text-[9px] rounded-full flex items-center justify-center border-none cursor-pointer"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main Text Area Container */}
      <div
        className={`relative flex flex-col rounded border transition-all duration-150 ${
          isFocused
            ? 'border-[var(--vscode-focusBorder)] ring-1 ring-[var(--vscode-focusBorder)]'
            : 'border-[var(--vscode-input-border,transparent)] bg-[var(--vscode-input-background)]'
        }`}
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

        {/* Input Bar Controls */}
        <div className="flex justify-between items-center px-2.5 pb-2 pt-1 z-20 pointer-events-auto">
          {/* Spacer */}
          <div />

          {/* Right actions: Images, Send */}
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
              disabled={(!inputValue.trim() && selectedImages.length === 0) || sendingDisabled}
              className={`p-1.5 rounded border-none cursor-pointer transition-colors ${
                (inputValue.trim() || selectedImages.length > 0) && !sendingDisabled
                  ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]'
                  : 'bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] opacity-40 cursor-not-allowed'
              }`}
            >
              <Send size={13} fill="currentColor" className="rotate-0" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

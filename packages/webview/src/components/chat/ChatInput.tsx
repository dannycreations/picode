import { cn } from 'cnfast';
import { Image as ImageIcon, Send } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

import { logger } from '@pi-code/shared/core/logger';
import { splitInputSegments } from '@pi-code/webview/components/chat/helpers/highlight';
import { useChatCommand, useChatMention, useChatTag } from '@pi-code/webview/components/chat/hooks/useSuggestion';
import { CommandMenu, CommitMenu, MentionMenu } from '@pi-code/webview/components/chat/SuggestionMenu';
import { ImageThumb } from '@pi-code/webview/components/shared/ImageThumb';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';
import { readFileAsDataUrl } from '@pi-code/webview/utilities/common';

import type { ChangeEvent, ClipboardEvent, DragEvent, FC, KeyboardEvent, RefObject } from 'react';

interface ChatInputProps {
  readonly onSend: (text: string, images: string[]) => void;
  readonly sendingDisabled: boolean;
  readonly placeholderText: string;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly supportsImages: boolean;
}

const AttachedImagesPreview: FC<{
  readonly images: string[];
  readonly onRemove: (index: number) => void;
}> = ({ images, onRemove }) => {
  if (images.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {images.map((img, idx) => (
        <div key={idx} className="relative w-10 h-10 rounded overflow-hidden">
          <ImageThumb url={img} />
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

export const ChatInput: FC<ChatInputProps> = ({ onSend, sendingDisabled, placeholderText, textareaRef, supportsImages }) => {
  const [isFocused, setIsFocused] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const inputValue = useChatStore((state) => state.inputValue);
  const setInputValue = useChatStore((state) => state.setInputValue);
  const commands = useChatStore((state) => state.commands);
  const selectedImages = useChatStore((state) => state.inputImages);
  const setSelectedImages = useChatStore((state) => state.setInputImages);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const matchRef = useRef<HTMLDivElement>(null);

  const command = useChatCommand({ commands, value: inputValue, setValue: setInputValue, textareaRef });
  const mention = useChatMention({ value: inputValue, setValue: setInputValue, textareaRef });
  const commit = useChatTag({ value: inputValue, setValue: setInputValue, textareaRef });
  const segments = useMemo(() => splitInputSegments(inputValue, commands), [inputValue, commands]);

  // Drop any staged images when the active model cannot accept them, so the
  // user cannot send attachments the model would reject.
  useEffect(() => {
    if (!supportsImages) setSelectedImages([]);
  }, [supportsImages]);

  const handleSend = () => {
    if ((inputValue.trim() || selectedImages.length > 0) && !sendingDisabled) {
      onSend(inputValue, selectedImages);
      setInputValue('');
      setSelectedImages([]);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // The picker owns navigation and acceptance keys while it is open.
    if (mention.handleKeyDown(e)) return;
    if (command.handleKeyDown(e)) return;
    if (commit.handleKeyDown(e)) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    command.handleChange(e);
    mention.handleChange(e);
    commit.handleChange(e);
  };

  const attachImage = async (file: File): Promise<void> => {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setSelectedImages((prev) => [...prev, dataUrl]);
    } catch (err) {
      logger.error('Failed to attach image:', err);
    }
  };

  const handleAttachImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await attachImage(file);
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!supportsImages) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (!items[i].type.includes('image')) continue;
      const file = items[i].getAsFile();
      if (!file) continue;
      e.preventDefault();
      await attachImage(file);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    // Only a Shift-drag may drop files as mentions; otherwise the textarea
    // keeps its ordinary behaviour and the drop is ignored.
    if (!e.shiftKey) {
      setIsDraggingOver(false);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    // Moving between children fires dragleave too; only clear when the pointer
    // actually leaves the input box, so the dotted outline does not flicker.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDraggingOver(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    setIsDraggingOver(false);
    if (!e.shiftKey) return;
    e.preventDefault();

    // VS Code delivers dragged editor tabs and files as a uri-list; a plain
    // text payload covers the remaining drag sources.
    const text = e.dataTransfer.getData('text') || e.dataTransfer.getData('application/vnd.code.uri-list');
    if (!text) return;

    const paths = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    if (paths.length === 0) return;

    useChatStore.getState().send({ type: 'insert_mentions', paths });
  };

  const isSendButtonActive = (inputValue.trim().length > 0 || selectedImages.length > 0) && !sendingDisabled;

  return (
    <div className={cn('relative flex flex-col px-3.5 pt-2 pb-1 outline-none w-full box-border bg-vscode-sideBar-background shrink-0')}>
      <AttachedImagesPreview images={selectedImages} onRemove={(idx) => setSelectedImages((prev) => prev.filter((_, i) => i !== idx))} />

      <div
        className={cn(
          'relative flex flex-col rounded border transition-all duration-150',
          isDraggingOver
            ? 'border-dashed border-vscode-focusBorder'
            : isFocused
              ? 'border-vscode-focusBorder ring-1 ring-vscode-focusBorder'
              : 'border-vscode-input-border bg-vscode-input-background',
        )}
      >
        {command.isOpen && (
          <CommandMenu commands={command.items} selectedIndex={command.selectedIndex} onSelect={command.select} onHover={command.setSelectedIndex} />
        )}
        {mention.isOpen && (
          <MentionMenu items={mention.items} selectedIndex={mention.selectedIndex} onSelect={mention.select} onHover={mention.setSelectedIndex} />
        )}
        {commit.isOpen && (
          <CommitMenu items={commit.items} selectedIndex={commit.selectedIndex} onSelect={commit.select} onHover={commit.setSelectedIndex} />
        )}
        <div className="relative flex" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <div
            ref={matchRef}
            aria-hidden="true"
            className={cn(
              'chat-input-text',
              'absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-transparent pointer-events-none select-none',
            )}
          >
            {segments.map((segment, index) =>
              segment.highlighted ? (
                <mark key={index} className="command-match">
                  {segment.text}
                </mark>
              ) : (
                <Fragment key={index}>{segment.text}</Fragment>
              ),
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
              mention.close();
              commit.close();
            }}
            onKeyDown={handleKeyDown}
            onSelect={() => {
              command.syncCaret();
              mention.syncCaret();
              commit.syncCaret();
            }}
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
            <Tooltip content={supportsImages ? 'Add image attachment' : 'Model does not support image attachments'}>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!supportsImages}
                className={cn('icon-button', supportsImages ? '' : 'opacity-40 cursor-not-allowed')}
              >
                <ImageIcon size={14} />
              </button>
            </Tooltip>

            <Tooltip content="Send message (Enter)">
              <button
                onClick={handleSend}
                disabled={!isSendButtonActive}
                className={cn('action-button p-1.5', isSendButtonActive ? '' : 'action-button-secondary opacity-40 cursor-not-allowed')}
              >
                <Send size={14} fill="currentColor" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
};

import { cn } from 'cn';
import { Paperclip, Send } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

import { logger } from '@pi-code/shared/core/logger';
import { classifyFileByContent, getFileExtension } from '@pi-code/webview/components/chat/helpers/attachment';
import { splitTokenSegments } from '@pi-code/webview/components/chat/helpers/highlight';
import { useChatCommand, useChatMention, useChatTag } from '@pi-code/webview/components/chat/hooks/useSuggestion';
import { CommandMenu, CommitMenu, MentionMenu } from '@pi-code/webview/components/chat/SuggestionMenu';
import { AttachmentThumb } from '@pi-code/webview/components/shared/AttachmentThumb';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';
import { readFileAsDataUrl } from '@pi-code/webview/utilities/common';

import type { ChangeEvent, ClipboardEvent, DragEvent, FC, KeyboardEvent, RefObject } from 'react';
import type { Attachment } from '@pi-code/shared/core/types';

interface ChatInputProps {
  readonly onSend: (text: string, attachments: Attachment[]) => void;
  readonly sendingDisabled: boolean;
  readonly placeholderText: string;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly supportsImages: boolean;
}

interface SuggestionController {
  readonly isOpen: boolean;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  readonly handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  readonly close: () => void;
  readonly syncCaret: () => void;
}

const AttachmentsPreview: FC<{
  readonly attachments: readonly Attachment[];
  readonly onRemove: (index: number) => void;
}> = ({ attachments, onRemove }) => {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {attachments.map((attachment, idx) => (
        <div key={idx} className="relative rounded overflow-hidden">
          <AttachmentThumb {...attachment} />
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
  const selectedAttachments = useChatStore((state) => state.inputAttachments);
  const setSelectedAttachments = useChatStore((state) => state.setInputAttachments);
  const settings = useChatStore((state) => state.settings);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const matchRef = useRef<HTMLDivElement>(null);

  const command = useChatCommand({ commands, value: inputValue, setValue: setInputValue, textareaRef });
  const mention = useChatMention({ value: inputValue, setValue: setInputValue, textareaRef });
  const commit = useChatTag({ value: inputValue, setValue: setInputValue, textareaRef });
  const suggestionControllers: readonly SuggestionController[] = [command, mention, commit];

  const segments = useMemo(() => splitTokenSegments(inputValue, commands), [inputValue, commands]);
  const minTextAttachment = settings?.minTextAttachment ?? 2000;

  // Drop any staged images when the active model cannot accept them, so the
  // user cannot send attachments the model would reject. Text attachments stay,
  // because they are delivered as plain text the model can always read.
  useEffect(() => {
    if (!supportsImages) setSelectedAttachments((prev) => prev.filter((attachment) => attachment.kind !== 'image'));
  }, [supportsImages]);

  const pushAttachment = (attachment: Attachment): void => {
    setSelectedAttachments((prev) => [...prev, attachment]);
  };

  const attachImage = async (file: File): Promise<void> => {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      pushAttachment({ kind: 'image', dataUrl });
    } catch (err) {
      logger.error('Failed to attach image:', err);
    }
  };

  const attachTextFile = async (file: File): Promise<void> => {
    try {
      const content = await file.text();
      pushAttachment({ kind: 'text', content, language: getFileExtension(file.name) || undefined });
    } catch (err) {
      logger.error('Failed to attach text file:', err);
    }
  };

  const addTextAttachment = (content: string): void => pushAttachment({ kind: 'text', content });

  const handleSend = () => {
    if ((inputValue.trim() || selectedAttachments.length > 0) && !sendingDisabled) {
      onSend(inputValue, selectedAttachments);
      setInputValue('');
      setSelectedAttachments([]);
    }
  };

  const insertTextAtCursor = (text: string): void => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setInputValue(inputValue + text);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setInputValue(inputValue.slice(0, start) + text + inputValue.slice(end));

    // Move cursor after the inserted text on next tick
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = start + text.length;
      textarea.focus();
    });
  };

  const handleKeyDown = async (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // An open suggestion popover owns navigation and acceptance keys.
    if (suggestionControllers.some((controller) => controller.handleKeyDown(e))) return;

    // Ctrl+Shift+V (or Cmd+Shift+V on Mac) inverts the default paste
    // behaviour: long text is inserted inline, short text becomes an
    // explicit attachment.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      try {
        const text = await navigator.clipboard.readText();
        if (!text) return;
        if (text.length >= minTextAttachment) insertTextAtCursor(text);
        else addTextAttachment(text);
      } catch {
        // Clipboard access denied or failed - ignore
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    suggestionControllers.forEach((controller) => controller.handleChange(e));
  };

  const handleAttachFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const kind = await classifyFileByContent(file);
    if (kind === 'text') {
      await attachTextFile(file);
    } else if (kind === 'image' && supportsImages) {
      await attachImage(file);
    }

    // Reset input so the same file can be re-selected if needed.
    e.target.value = '';
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    if (supportsImages) {
      const imageFiles = Array.from(items)
        .filter((item) => item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);

      if (imageFiles.length > 0) {
        e.preventDefault();
        await Promise.all(imageFiles.map(attachImage));
        return;
      }
    }

    // A large plain-text paste becomes a text attachment instead of filling
    // the composer, so the transcript keeps a short prompt and the pasted
    // content reaches the model as a markdown block.
    const pasted = e.clipboardData.getData('text');
    if (pasted.length >= minTextAttachment) {
      e.preventDefault();
      addTextAttachment(pasted);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    // Shift-drag still inserts @mentions. Without Shift, allow drops for
    // model-supported attachments: text files and, when the model supports
    // them, images. Unsupported or mixed-type drops are ignored.
    const hasFiles = e.dataTransfer.types.includes('Files');

    if (hasFiles) {
      e.preventDefault();

      // Shift-drag without real files still targets @mention insertion;
      // leave the drag-over state untouched.
      if (e.shiftKey && e.dataTransfer.files.length === 0) return;

      const mimeTypes = new Set(Array.from(e.dataTransfer.files, (file) => file.type));
      const [soleType] = mimeTypes;
      const isDroppableText = mimeTypes.size === 1 && soleType.startsWith('text/');
      const isDroppableImage = mimeTypes.size === 1 && supportsImages && soleType.startsWith('image/');

      if (isDroppableText || isDroppableImage) {
        e.dataTransfer.dropEffect = 'copy';
        setIsDraggingOver(true);
      } else {
        setIsDraggingOver(false);
      }
      return;
    }

    if (e.shiftKey) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDraggingOver(true);
    } else {
      setIsDraggingOver(false);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    // Moving between children fires dragleave too; only clear when the pointer
    // actually leaves the input box, so the dotted outline does not flicker.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    setIsDraggingOver(false);

    // Shift-drag inserts @mentions for paths/URIs; if no usable path text is
    // present, it falls through to plain file-attachment handling below.
    if (e.shiftKey) {
      e.preventDefault();
      const text = e.dataTransfer.getData('text') || e.dataTransfer.getData('application/vnd.code.uri-list');
      const paths = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));

      if (paths.length > 0) {
        useChatStore.getState().send({ type: 'insert_mentions', paths });
        return;
      }
    }

    // Plain file drop: convert to model-supported attachments,
    // ignoring unsupported file types.
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    e.preventDefault();

    const classified = await Promise.all(files.map(async (file) => ({ file, kind: await classifyFileByContent(file) })));
    const textFiles = classified.filter(({ kind }) => kind === 'text').map(({ file }) => file);
    const imageFiles = supportsImages ? classified.filter(({ kind }) => kind === 'image').map(({ file }) => file) : [];

    await Promise.all([...textFiles.map(attachTextFile), ...imageFiles.map(attachImage)]);
  };

  const isSendButtonActive = (inputValue.trim().length > 0 || selectedAttachments.length > 0) && !sendingDisabled;

  return (
    <div className={cn('relative flex flex-col px-3.5 pt-2 pb-1 outline-none w-full box-border bg-vscode-sideBar-background shrink-0')}>
      <AttachmentsPreview attachments={selectedAttachments} onRemove={(idx) => setSelectedAttachments((prev) => prev.filter((_, i) => i !== idx))} />

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
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              setIsFocused(false);
              suggestionControllers.forEach((controller) => controller.close());
            }}
            onKeyDown={handleKeyDown}
            onSelect={() => suggestionControllers.forEach((controller) => controller.syncCaret())}
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
            <input type="file" ref={fileInputRef} onChange={handleAttachFile} className="hidden" />
            <Tooltip content="Add attachment">
              <button onClick={() => fileInputRef.current?.click()} className={cn('icon-button')}>
                <Paperclip size={14} />
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

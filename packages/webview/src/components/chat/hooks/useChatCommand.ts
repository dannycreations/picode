import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { applyCommand, matchCommands, readCommandQuery } from '@pi-code/webview/components/chat/helpers/command';

import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';
import type { CommandItem } from '@pi-code/shared/protocol';

export interface UseCommandOptions {
  readonly commands: readonly CommandItem[];
  readonly value: string;
  readonly setValue: (value: string) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export interface UseCommandResult {
  readonly isOpen: boolean;
  readonly matches: CommandItem[];
  readonly selectedIndex: number;
  readonly setSelectedIndex: (index: number) => void;
  readonly select: (command: CommandItem) => void;
  readonly close: () => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  readonly handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  readonly syncCaret: () => void;
}

export const useChatCommand = ({ commands, value, setValue, textareaRef }: UseCommandOptions): UseCommandResult => {
  const [caret, setCaret] = useState(0);
  const [isDismissed, setIsDismissed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Bumped on every accepted completion so the caret is restored even when the
  // inserted text happens to equal what was already there.
  const [caretRequest, setCaretRequest] = useState(0);
  const pendingCaretRef = useRef<number | null>(null);

  const query = useMemo(() => readCommandQuery(value, Math.min(caret, value.length)), [value, caret]);
  const matches = useMemo(() => (query ? matchCommands(commands, query.query) : []), [commands, query]);

  // Staying closed when nothing matches keeps Enter free to send the message.
  const isOpen = !isDismissed && query !== null && matches.length > 0;

  useEffect(() => {
    setSelectedIndex(0);
  }, [matches]);

  useLayoutEffect(() => {
    const target = pendingCaretRef.current;
    if (target === null) return;
    pendingCaretRef.current = null;

    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.focus();
    textarea.setSelectionRange(target, target);
  }, [caretRequest, textareaRef]);

  const close = useCallback(() => setIsDismissed(true), []);

  const syncCaret = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) setCaret(textarea.selectionStart ?? 0);
  }, [textareaRef]);

  const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    // Typing always revives a picker the user dismissed with Escape.
    setIsDismissed(false);
    setCaret(event.target.selectionStart ?? event.target.value.length);
  }, []);

  const select = useCallback(
    (command: CommandItem) => {
      const insertion = applyCommand(value, command.name);

      pendingCaretRef.current = insertion.caret;
      setCaretRequest((previous) => previous + 1);
      setValue(insertion.text);
      setCaret(insertion.caret);
    },
    [value, setValue],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!isOpen) return false;

      switch (event.key) {
        case 'Escape': {
          event.preventDefault();
          event.stopPropagation();
          close();
          return true;
        }
        case 'ArrowUp':
        case 'ArrowDown': {
          event.preventDefault();
          const direction = event.key === 'ArrowDown' ? 1 : -1;
          setSelectedIndex((previous) => (previous + direction + matches.length) % matches.length);
          return true;
        }
        case 'Enter':
        case 'Tab': {
          // Shift+Enter inserts a newline and Shift+Tab moves focus.
          if (event.shiftKey) return false;

          const command = matches[selectedIndex];
          if (!command) return false;

          event.preventDefault();
          select(command);
          return true;
        }
        default:
          return false;
      }
    },
    [isOpen, matches, selectedIndex, close, select],
  );

  return { isOpen, matches, selectedIndex, setSelectedIndex, select, close, handleKeyDown, handleChange, syncCaret };
};

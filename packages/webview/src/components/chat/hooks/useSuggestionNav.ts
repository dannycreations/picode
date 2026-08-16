import { useCallback } from 'react';

import type { ChangeEvent, Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';

interface SuggestionNavConfig<T> {
  readonly isOpen: boolean;
  readonly items: readonly T[];
  readonly selectedIndex: number;
  readonly setSelectedIndex: Dispatch<SetStateAction<number>>;
  readonly select: (item: T) => void;
  readonly setDismissed: (dismissed: boolean) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly setCaret: (caret: number) => void;
}

export function useSuggestionNav<T>(config: SuggestionNavConfig<T>) {
  const { isOpen, items, selectedIndex, setSelectedIndex, select, setDismissed, textareaRef, setCaret } = config;

  const close = useCallback(() => setDismissed(true), [setDismissed]);

  const syncCaret = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) setCaret(textarea.selectionStart ?? 0);
  }, [textareaRef, setCaret]);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      // Typing always revives a picker the user dismissed with Escape.
      setDismissed(false);
      setCaret(event.target.selectionStart ?? event.target.value.length);
    },
    [setDismissed, setCaret],
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
          setSelectedIndex((previous) => (previous + direction + items.length) % items.length);
          return true;
        }
        case 'Enter':
        case 'Tab': {
          // Shift+Enter inserts a newline and Shift+Tab moves focus.
          if (event.shiftKey) return false;

          const item = items[selectedIndex];
          if (!item) return false;

          event.preventDefault();
          select(item);
          return true;
        }
        default:
          return false;
      }
    },
    [isOpen, items, selectedIndex, close, select, setSelectedIndex],
  );

  return { close, syncCaret, handleChange, handleKeyDown };
}

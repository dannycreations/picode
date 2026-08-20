import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { applyCommand, matchCommands, readCommandQuery } from '@pi-code/webview/components/chat/helpers/command';
import { applyMention, readMentionQuery } from '@pi-code/webview/components/chat/helpers/mention';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { ChangeEvent, Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import type { CommandItem } from '@pi-code/shared/core/protocol';

interface UseNavigationProps<T> {
  readonly isOpen: boolean;
  readonly items: readonly T[];
  readonly selectedIndex: number;
  readonly setSelectedIndex: Dispatch<SetStateAction<number>>;
  readonly select: (item: T) => void;
  readonly setDismissed: (dismissed: boolean) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly setCaret: (caret: number) => void;
}

interface UseNavigationReturn {
  readonly close: () => void;
  readonly syncCaret: () => void;
  readonly handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

const useNavigation = <T>(config: UseNavigationProps<T>): UseNavigationReturn => {
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
};

interface UseSuggestionProps<T> {
  readonly value: string;
  readonly setValue: (value: string) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  // Returns the active token's search text, or null when the caret is not
  // inside a token (so the menu can stay closed and free up Enter to send).
  readonly readQuery: (value: string, caret: number) => string | null;
  // Turns the chosen item into the text+caret to insert.
  readonly applyInsertion: (value: string, caret: number, item: T) => { readonly text: string; readonly caret: number };
  // Synchronous item source (commands). Adapters with an asynchronous source
  // omit this and drive `items` through the returned setItems instead.
  readonly resolveItems?: (query: string) => readonly T[];
}

interface UseSuggestionReturn<T> {
  readonly isOpen: boolean;
  readonly items: readonly T[];
  readonly query: string | null;
  readonly selectedIndex: number;
  readonly setSelectedIndex: Dispatch<SetStateAction<number>>;
  readonly setItems: Dispatch<SetStateAction<readonly T[]>>;
  readonly select: (item: T) => void;
  readonly close: () => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  readonly handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  readonly syncCaret: () => void;
}

const useSuggestion = <T>(props: UseSuggestionProps<T>): UseSuggestionReturn<T> => {
  const { value, setValue, textareaRef, readQuery, applyInsertion, resolveItems } = props;

  const [caret, setCaret] = useState(0);
  const [isDismissed, setIsDismissed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Bumped on every accepted completion so the caret is restored even when the
  // inserted text happens to equal what was already there.
  const [caretRequest, setCaretRequest] = useState(0);
  const pendingCaretRef = useRef<number | null>(null);

  const query = useMemo(() => readQuery(value, Math.min(caret, value.length)), [value, caret, readQuery]);

  const resolvedItems = useMemo<readonly T[]>(() => (resolveItems && query !== null ? resolveItems(query) : []), [resolveItems, query]);
  const [asyncItems, setItems] = useState<readonly T[]>([]);
  const items = resolveItems ? resolvedItems : asyncItems;

  const isOpen = !isDismissed && query !== null && items.length > 0;

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  useLayoutEffect(() => {
    const target = pendingCaretRef.current;
    if (target === null) return;
    pendingCaretRef.current = null;

    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.focus();
    textarea.setSelectionRange(target, target);
  }, [caretRequest, textareaRef]);

  const select = useCallback(
    (item: T) => {
      const insertion = applyInsertion(value, caret, item);

      pendingCaretRef.current = insertion.caret;
      setCaretRequest((previous) => previous + 1);
      setValue(insertion.text);
      setCaret(insertion.caret);
    },
    [applyInsertion, value, caret, setValue],
  );

  const { close, syncCaret, handleChange, handleKeyDown } = useNavigation<T>({
    isOpen,
    items,
    selectedIndex,
    setSelectedIndex,
    select,
    setDismissed: setIsDismissed,
    textareaRef,
    setCaret,
  });

  return { isOpen, items, query, selectedIndex, setSelectedIndex, setItems, select, close, handleKeyDown, handleChange, syncCaret };
};

interface UseCommandProps {
  readonly commands: readonly CommandItem[];
  readonly value: string;
  readonly setValue: (value: string) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}

interface UseCommandReturn {
  readonly isOpen: boolean;
  readonly matches: readonly CommandItem[];
  readonly selectedIndex: number;
  readonly setSelectedIndex: (index: number) => void;
  readonly select: (command: CommandItem) => void;
  readonly close: () => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  readonly handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  readonly syncCaret: () => void;
}

export const useChatCommand = ({ commands, value, setValue, textareaRef }: UseCommandProps): UseCommandReturn => {
  const resolveItems = useCallback((query: string) => matchCommands(commands, query), [commands]);

  const suggestion = useSuggestion<CommandItem>({
    value,
    setValue,
    textareaRef,
    readQuery: (text, caret) => readCommandQuery(text, caret)?.query ?? null,
    applyInsertion: (text, _caret, command) => applyCommand(text, command.name),
    resolveItems,
  });

  return {
    isOpen: suggestion.isOpen,
    matches: suggestion.items,
    selectedIndex: suggestion.selectedIndex,
    setSelectedIndex: suggestion.setSelectedIndex,
    select: suggestion.select,
    close: suggestion.close,
    handleKeyDown: suggestion.handleKeyDown,
    handleChange: suggestion.handleChange,
    syncCaret: suggestion.syncCaret,
  };
};

interface UseMentionProps {
  readonly value: string;
  readonly setValue: (value: string) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}

interface UseMentionReturn {
  readonly isOpen: boolean;
  readonly results: readonly string[];
  readonly selectedIndex: number;
  readonly setSelectedIndex: (index: number) => void;
  readonly select: (path: string) => void;
  readonly close: () => void;
  readonly handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  readonly handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  readonly syncCaret: () => void;
}

export const useChatMention = ({ value, setValue, textareaRef }: UseMentionProps): UseMentionReturn => {
  const {
    isOpen,
    items,
    query,
    selectedIndex,
    setSelectedIndex,
    select: hookSelect,
    close,
    setItems,
    handleKeyDown,
    handleChange,
    syncCaret,
  } = useSuggestion<string>({
    value,
    setValue,
    textareaRef,
    readQuery: (text, caret) => readMentionQuery(text, caret)?.query ?? null,
    applyInsertion: (text, caret, path) => applyMention(text, caret, path),
  });

  const searchResults = useChatStore((state) => state.searchResults);

  useEffect(() => {
    setItems(searchResults);
    setSelectedIndex(0);
  }, [searchResults, setItems, setSelectedIndex]);

  useEffect(() => {
    if (query === null) {
      setItems([]);
      return;
    }
    const requestId = crypto.randomUUID();
    const handle = setTimeout(() => {
      useChatStore.getState().send({ type: 'search_files', query, requestId });
    }, 200);
    return () => clearTimeout(handle);
  }, [query, setItems]);

  const select = (path: string): void => {
    hookSelect(path);
    setItems([]);
    close();
  };

  return { isOpen, results: items, selectedIndex, setSelectedIndex, select, close, handleKeyDown, handleChange, syncCaret };
};

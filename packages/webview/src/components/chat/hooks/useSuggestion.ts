import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { applyCommand, matchCommands, readCommandQuery } from '@pi-code/webview/components/chat/helpers/command';
import { applyMention, readMentionQuery } from '@pi-code/webview/components/chat/helpers/mention';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { ChangeEvent, Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import type { CommandItem } from '@pi-code/shared/core/protocol';

interface UseSuggestionProps<T> {
  readonly value: string;
  readonly setValue: (value: string) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  // Returns the active token's search text, or null when the caret is not
  // inside a token (so the menu can stay closed and free up Enter to send).
  readonly readQuery: (value: string, caret: number) => string | null;
  // Turns the chosen item into the text+caret to insert.
  readonly applyInsertion: (value: string, caret: number, item: T) => { readonly text: string; readonly caret: number };
  // Resolves the candidates for the active query. Adapters backed by external
  // state (mentions) return a closure over that state; it must change identity
  // whenever the underlying results change.
  readonly resolveItems?: (query: string) => readonly T[];
}

interface UseSuggestionReturn<T> {
  readonly isOpen: boolean;
  readonly items: readonly T[];
  readonly query: string | null;
  readonly selectedIndex: number;
  readonly setSelectedIndex: Dispatch<SetStateAction<number>>;
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

  const items = useMemo<readonly T[]>(() => (query !== null && resolveItems ? resolveItems(query) : []), [resolveItems, query]);

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

  // Escape dismisses the picker; typing revives it again.
  const close = useCallback(() => setIsDismissed(true), []);

  const syncCaret = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) setCaret(textarea.selectionStart ?? 0);
  }, [textareaRef]);

  const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setIsDismissed(false);
    setCaret(event.target.selectionStart ?? event.target.value.length);
  }, []);

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
    [isOpen, items, selectedIndex, close, select],
  );

  return { isOpen, items, query, selectedIndex, setSelectedIndex, select, close, handleKeyDown, handleChange, syncCaret };
};

interface UseCommandProps {
  readonly commands: readonly CommandItem[];
  readonly value: string;
  readonly setValue: (value: string) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export const useChatCommand = ({ commands, value, setValue, textareaRef }: UseCommandProps): UseSuggestionReturn<CommandItem> => {
  const resolveItems = useCallback((query: string) => matchCommands(commands, query), [commands]);

  return useSuggestion<CommandItem>({
    value,
    setValue,
    textareaRef,
    readQuery: (text, caret) => readCommandQuery(text, caret)?.query ?? null,
    applyInsertion: (text, _caret, command) => applyCommand(text, command.name),
    resolveItems,
  });
};

interface UseMentionProps {
  readonly value: string;
  readonly setValue: (value: string) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export const useChatMention = ({ value, setValue, textareaRef }: UseMentionProps): UseSuggestionReturn<string> => {
  const searchResults = useChatStore((state) => state.searchResults);

  // Results arrive asynchronously through the store; reading them here keeps a
  // single source instead of mirroring store state into hook state.
  const resolveResults = useCallback(() => searchResults, [searchResults]);

  const suggestion = useSuggestion<string>({
    value,
    setValue,
    textareaRef,
    readQuery: (text, caret) => readMentionQuery(text, caret)?.query ?? null,
    applyInsertion: applyMention,
    resolveItems: resolveResults,
  });

  const { query } = suggestion;

  useEffect(() => {
    if (query === null) return;
    const requestId = crypto.randomUUID();
    // The store drops search_results whose id does not match, so register the
    // request before sending to keep a stale response from ever winning.
    useChatStore.setState({ searchRequestId: requestId });
    const handle = setTimeout(() => {
      useChatStore.getState().send({ type: 'search_files', query, requestId });
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  return suggestion;
};

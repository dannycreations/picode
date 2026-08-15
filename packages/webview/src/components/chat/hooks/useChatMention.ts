import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { applyMention, readMentionQuery } from '@pi-code/webview/components/chat/helpers/mention';
import { vscode } from '@pi-code/webview/utilities/vscode';

import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';

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

const DEBOUNCE_MS = 200;

export const useChatMention = ({ value, setValue, textareaRef }: UseMentionProps): UseMentionReturn => {
  const [caret, setCaret] = useState(0);
  const [isDismissed, setIsDismissed] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const requestIdRef = useRef('');

  const query = useMemo(() => readMentionQuery(value, Math.min(caret, value.length)), [value, caret]);
  const isOpen = !isDismissed && query !== null && results.length > 0;

  // Receive search results streamed back from the extension host.
  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      const msg = event.data;
      if (msg?.type === 'search_results' && msg.payload?.requestId === requestIdRef.current) {
        setResults(msg.payload.paths);
        setSelectedIndex(0);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Query the host whenever the active mention changes.
  useEffect(() => {
    if (query === null) {
      setResults([]);
      return;
    }
    const requestId = crypto.randomUUID();
    requestIdRef.current = requestId;
    const handle = setTimeout(() => {
      vscode?.postMessage({ type: 'search_files', query: query.query, requestId });
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const close = useCallback(() => setIsDismissed(true), []);

  const syncCaret = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) setCaret(textarea.selectionStart ?? 0);
  }, [textareaRef]);

  const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setIsDismissed(false);
    setCaret(event.target.selectionStart ?? event.target.value.length);
  }, []);

  const select = useCallback(
    (path: string) => {
      const insertion = applyMention(value, caret, path);
      setValue(insertion.text);
      setCaret(insertion.caret);
      setResults([]);
      setIsDismissed(true);
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(insertion.caret, insertion.caret);
      }
    },
    [value, caret, setValue, textareaRef],
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
          setSelectedIndex((prev) => (prev + direction + results.length) % results.length);
          return true;
        }
        case 'Enter':
        case 'Tab': {
          // Shift+Enter inserts a newline and Shift+Tab moves focus.
          if (event.shiftKey) return false;

          const path = results[selectedIndex];
          if (!path) return false;

          event.preventDefault();
          select(path);
          return true;
        }
        default:
          return false;
      }
    },
    [isOpen, results, selectedIndex, close, select],
  );

  return { isOpen, results, selectedIndex, setSelectedIndex, select, close, handleKeyDown, handleChange, syncCaret };
};

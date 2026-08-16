import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { applyMention, readMentionQuery } from '@pi-code/webview/components/chat/helpers/mention';
import { useSuggestionNav } from '@pi-code/webview/components/chat/hooks/useSuggestionNav';
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

  const { close, syncCaret, handleChange, handleKeyDown } = useSuggestionNav<string>({
    isOpen,
    items: results,
    selectedIndex,
    setSelectedIndex,
    select,
    setDismissed: setIsDismissed,
    textareaRef,
    setCaret,
  });

  return { isOpen, results, selectedIndex, setSelectedIndex, select, close, handleKeyDown, handleChange, syncCaret };
};

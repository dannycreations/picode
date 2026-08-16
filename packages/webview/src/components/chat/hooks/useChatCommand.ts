import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { applyCommand, matchCommands, readCommandQuery } from '@pi-code/webview/components/chat/helpers/command';
import { useSuggestionNav } from '@pi-code/webview/components/chat/hooks/useSuggestionNav';

import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';
import type { CommandItem } from '@pi-code/shared/core/protocol';

interface UseCommandProps {
  readonly commands: readonly CommandItem[];
  readonly value: string;
  readonly setValue: (value: string) => void;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}

interface UseCommandReturn {
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

export const useChatCommand = ({ commands, value, setValue, textareaRef }: UseCommandProps): UseCommandReturn => {
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

  const { close, syncCaret, handleChange, handleKeyDown } = useSuggestionNav<CommandItem>({
    isOpen,
    items: matches,
    selectedIndex,
    setSelectedIndex,
    select,
    setDismissed: setIsDismissed,
    textareaRef,
    setCaret,
  });

  return { isOpen, matches, selectedIndex, setSelectedIndex, select, close, handleKeyDown, handleChange, syncCaret };
};

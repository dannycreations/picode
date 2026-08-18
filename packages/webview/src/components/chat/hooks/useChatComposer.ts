import { useCallback, useRef, useState } from 'react';

import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { ExtensionToWebviewMessage } from '@pi-code/shared/core/protocol';

interface UseChatComposerReturn {
  readonly view: 'chat' | 'history' | 'settings';
  readonly setView: Dispatch<SetStateAction<'chat' | 'history' | 'settings'>>;
  readonly inputValue: string;
  readonly setInputValue: Dispatch<SetStateAction<string>>;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly appendToInput: (text: string) => void;
  readonly onMessage: (msg: ExtensionToWebviewMessage) => void;
}

export const useChatComposer = (): UseChatComposerReturn => {
  const [view, setView] = useState<'chat' | 'history' | 'settings'>('chat');
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const appendToInput = useCallback((text: string): void => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setInputValue((prev) => (prev ? `${prev}\n${text}` : text));
      return;
    }

    const caret = textarea.selectionStart;

    setInputValue((prev) => `${prev.slice(0, caret)}${text}${prev.slice(caret)}`);

    const nextCaret = caret + text.length;
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    }, 0);
  }, []);

  const onMessage = useCallback(
    (msg: ExtensionToWebviewMessage): void => {
      switch (msg.type) {
        case 'show_settings':
          setView('settings');
          break;

        case 'session_loaded':
          setView('chat');
          break;

        case 'set_chat_input':
          appendToInput(msg.payload.text);
          break;
      }
    },
    [appendToInput],
  );

  return { view, setView, inputValue, setInputValue, textareaRef, appendToInput, onMessage };
};

import { useCallback, useRef, useState } from 'react';

import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { ExtensionToWebviewMessage, HistoryScope } from '@pi-code/shared/core/protocol';

interface UseChatComposerReturn {
  readonly view: 'chat' | 'history' | 'settings';
  readonly setView: Dispatch<SetStateAction<'chat' | 'history' | 'settings'>>;
  readonly scope: HistoryScope;
  readonly setScope: Dispatch<SetStateAction<HistoryScope>>;
  readonly inputValue: string;
  readonly setInputValue: Dispatch<SetStateAction<string>>;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly onMessage: (msg: ExtensionToWebviewMessage) => void;
}

export const useChatComposer = (): UseChatComposerReturn => {
  const [view, setView] = useState<'chat' | 'history' | 'settings'>('chat');
  const [scope, setScope] = useState<HistoryScope>('current');
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const onMessage = useCallback((msg: ExtensionToWebviewMessage): void => {
    switch (msg.type) {
      case 'show_settings':
        setView('settings');
        break;

      case 'info':
      case 'session_loaded':
        setView('chat');
        break;

      case 'set_chat_input':
        setInputValue((prev) => (prev ? `${prev}\n${msg.payload.text}` : msg.payload.text));
        setTimeout(() => textareaRef.current?.focus(), 0);
        break;
    }
  }, []);

  return { view, setView, scope, setScope, inputValue, setInputValue, textareaRef, onMessage };
};

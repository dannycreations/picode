import { useEffect, useRef, useState } from 'react';

import type { Dispatch, RefObject, SetStateAction } from 'react';

export interface UseAutoScrollReturn {
  readonly messagesEndRef: RefObject<HTMLDivElement | null>;
  readonly scrollContainerRef: RefObject<HTMLDivElement | null>;
  readonly showScrollToBottom: boolean;
  readonly setShowScrollToBottom: Dispatch<SetStateAction<boolean>>;
  readonly handleScroll: () => void;
  readonly scrollToBottom: () => void;
}

export const useAutoScroll = (messagesDeps: unknown[], resetKey?: unknown): UseAutoScrollReturn => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const handleScroll = (): void => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setShowScrollToBottom(!isAtBottom);
  };

  const scrollToBottom = (): void => {
    setShowScrollToBottom(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Reset scroll button state on task switch
  useEffect(() => {
    setShowScrollToBottom(false);
  }, [resetKey]);

  // Auto scroll to bottom when messages update (unless user scrolled up)
  useEffect(() => {
    if (!showScrollToBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messagesDeps, showScrollToBottom]);

  return {
    messagesEndRef,
    scrollContainerRef,
    showScrollToBottom,
    setShowScrollToBottom,
    handleScroll,
    scrollToBottom,
  };
};

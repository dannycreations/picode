import { useEffect, useRef, useState } from 'react';

export function useAutoScroll(messagesDeps: unknown[], resetKey?: unknown) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setShowScrollToBottom(!isAtBottom);
  };

  const scrollToBottom = () => {
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
}

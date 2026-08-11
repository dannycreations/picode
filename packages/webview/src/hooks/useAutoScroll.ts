import { useCallback, useEffect, useRef, useState } from 'react';

import type { RefCallback, RefObject } from 'react';

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

// Distance from the bottom that still counts as following the conversation.
export const AT_BOTTOM_THRESHOLD_PX = 32;

// Upward drift from the last pin that reads as a deliberate scroll rather than layout noise.
const PIN_RELEASE_TOLERANCE_PX = 4;

export function isAtBottom(metrics: ScrollMetrics, threshold: number = AT_BOTTOM_THRESHOLD_PX): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}

export function hasScrolledAwayFromPin(scrollTop: number, pinnedTop: number, tolerance: number = PIN_RELEASE_TOLERANCE_PX): boolean {
  return scrollTop < pinnedTop - tolerance;
}

export function shouldReleaseFollow(metrics: ScrollMetrics, pinnedTop: number): boolean {
  return hasScrolledAwayFromPin(metrics.scrollTop, pinnedTop) && !isAtBottom(metrics);
}

interface UseAutoScrollReturn {
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly contentRef: RefCallback<HTMLDivElement>;
  readonly showScrollToBottom: boolean;
  readonly handleScroll: () => void;
  readonly scrollToBottom: () => void;
}

export const useAutoScroll = (resetKey?: unknown): UseAutoScrollReturn => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const isFollowingRef = useRef(true);
  const pinnedTopRef = useRef(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const scrollToBottom = useCallback((): void => {
    isFollowingRef.current = true;
    setShowScrollToBottom(false);

    const scroller = scrollRef.current;
    if (!scroller) return;

    scroller.scrollTop = scroller.scrollHeight;
    pinnedTopRef.current = scroller.scrollTop;
  }, []);

  const handleScroll = useCallback((): void => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    const atBottom = isAtBottom(scroller);
    if (isFollowingRef.current) {
      if (shouldReleaseFollow(scroller, pinnedTopRef.current)) {
        isFollowingRef.current = false;
      } else if (atBottom) {
        pinnedTopRef.current = scroller.scrollTop;
      }
    } else if (atBottom) {
      isFollowingRef.current = true;
      pinnedTopRef.current = scroller.scrollTop;
    }
    setShowScrollToBottom(!isFollowingRef.current);
  }, []);

  // A callback ref rather than an effect: the observer has to follow the content
  // element through every mount and unmount, including the ones caused by
  // switching to the history or settings view, not just through task changes.
  const contentRef = useCallback<RefCallback<HTMLDivElement>>(
    (node) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;

      const observer = new ResizeObserver(() => {
        const scroller = scrollRef.current;
        if (!scroller || !isFollowingRef.current) return;

        // The resize can be observed before the user's own scroll event is
        // dispatched, so the live position is re-checked before overriding it.
        if (shouldReleaseFollow(scroller, pinnedTopRef.current)) {
          isFollowingRef.current = false;
          setShowScrollToBottom(true);
          return;
        }

        scroller.scrollTop = scroller.scrollHeight;
        pinnedTopRef.current = scroller.scrollTop;
      });

      observer.observe(node);
      observerRef.current = observer;
      scrollToBottom();
    },
    [scrollToBottom],
  );

  // Opening a different task starts at the newest message.
  useEffect(() => {
    scrollToBottom();
  }, [resetKey, scrollToBottom]);

  return { scrollRef, contentRef, showScrollToBottom, handleScroll, scrollToBottom };
};

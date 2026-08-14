import { useCallback, useEffect, useRef, useState } from 'react';

import type { RefCallback, RefObject } from 'react';

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

// Distance from the bottom that still counts as following the conversation.
export const AT_BOTTOM_THRESHOLD_PX = 32;

export function isAtBottom(metrics: ScrollMetrics, threshold: number = AT_BOTTOM_THRESHOLD_PX): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}

export function resolveFollowState(params: { atBottom: boolean; scrolledUp: boolean; isFollowing: boolean }): boolean {
  if (params.atBottom) return true;
  if (!params.isFollowing) return false;
  return !params.scrolledUp;
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
  const lastScrollTopRef = useRef(0);

  // True while a scrollTop change was made by *our own* code (scrollToBottom
  // or the ResizeObserver auto-follow) rather than the user. The `scroll`
  // event fired by such a write must never be mistaken for the user
  // scrolling up — that's what was silently killing stickiness whenever a
  // few renders landed close together.
  const isProgrammaticScrollRef = useRef(false);
  const clearProgrammaticFlagRafRef = useRef<number | null>(null);

  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  // Centralized helper: any time *we* move the scroll position, go through
  // here so the flag is always set/cleared consistently.
  const writeScrollTop = useCallback((scroller: HTMLDivElement, value: number): void => {
    isProgrammaticScrollRef.current = true;
    scroller.scrollTop = value;
    lastScrollTopRef.current = scroller.scrollTop;

    // Scroll events caused by a programmatic write are dispatched by the
    // browser on a later frame (sometimes not at all, if the value didn't
    // actually change). Clear the flag on the next frame so it can't get
    // stuck and swallow a genuine user scroll afterwards.
    if (clearProgrammaticFlagRafRef.current !== null) {
      cancelAnimationFrame(clearProgrammaticFlagRafRef.current);
    }
    clearProgrammaticFlagRafRef.current = requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
      clearProgrammaticFlagRafRef.current = null;
    });
  }, []);

  const scrollToBottom = useCallback((): void => {
    isFollowingRef.current = true;
    setShowScrollToBottom(false);

    const scroller = scrollRef.current;
    if (!scroller) return;

    writeScrollTop(scroller, scroller.scrollHeight);
  }, [writeScrollTop]);

  const handleScroll = useCallback((): void => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    // This scroll event was caused by our own code, not the user.
    // Sync the tracked position but never let it affect follow state.
    if (isProgrammaticScrollRef.current) {
      lastScrollTopRef.current = scroller.scrollTop;
      return;
    }

    const atBottom = isAtBottom(scroller);
    const scrolledUp = scroller.scrollTop < lastScrollTopRef.current;
    const isFollowing = resolveFollowState({ atBottom, scrolledUp, isFollowing: isFollowingRef.current });

    lastScrollTopRef.current = scroller.scrollTop;

    // Only re-render when the follow state actually flips.
    if (isFollowing === isFollowingRef.current) return;
    isFollowingRef.current = isFollowing;
    setShowScrollToBottom(!isFollowing);
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

        // Content grew while following: keep the newest output in view.
        writeScrollTop(scroller, scroller.scrollHeight);
      });

      observer.observe(node);
      observerRef.current = observer;
      scrollToBottom();
    },
    [scrollToBottom, writeScrollTop],
  );

  // Opening a different task starts at the newest message.
  useEffect(() => {
    scrollToBottom();
  }, [resetKey, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (clearProgrammaticFlagRafRef.current !== null) {
        cancelAnimationFrame(clearProgrammaticFlagRafRef.current);
      }
    };
  }, []);

  return { scrollRef, contentRef, showScrollToBottom, handleScroll, scrollToBottom };
};

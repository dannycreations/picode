import { useCallback, useEffect, useRef, useState } from 'react';

import type { KeyboardEvent, RefCallback, RefObject } from 'react';

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

// Distance from the bottom that still counts as following the conversation.
export const AT_BOTTOM_THRESHOLD_PX = 32;

// How long after a real user gesture (wheel/touch/pointer/key) we still
// trust an upward scrollTop delta as intentional. Anything outside this
// window — layout shifts, browser scroll anchoring, our own corrective
// writes — must never be treated as "the user scrolled up".
const USER_INTENT_WINDOW_MS = 400;

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
  readonly onWheel: () => void;
  readonly onTouchStart: () => void;
  readonly onPointerDown: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

const SCROLL_INTENT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

export const useAutoScroll = (resetKey?: unknown): UseAutoScrollReturn => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const isFollowingRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  // Set for any scrollTop write we perform ourselves. Cleared a frame later.
  // Kept as a first line of defense; the user-intent window below is the
  // one that actually matters for browser-triggered scroll anchoring.
  const isProgrammaticScrollRef = useRef(false);
  const clearProgrammaticFlagRafRef = useRef<number | null>(null);

  // Coalesce ResizeObserver bursts (e.g. 3 renders in one frame) into a
  // single scrollTop write instead of one write per callback.
  const pendingFollowWriteRafRef = useRef<number | null>(null);

  // Timestamp of the last real, physical user input aimed at scrolling.
  const lastUserIntentAtRef = useRef(0);

  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const markUserIntent = useCallback((): void => {
    lastUserIntentAtRef.current = Date.now();
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (SCROLL_INTENT_KEYS.has(event.key)) markUserIntent();
    },
    [markUserIntent],
  );

  const writeScrollTop = useCallback((scroller: HTMLDivElement, value: number): void => {
    isProgrammaticScrollRef.current = true;
    scroller.scrollTop = value;
    lastScrollTopRef.current = scroller.scrollTop;

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

    if (isProgrammaticScrollRef.current) {
      lastScrollTopRef.current = scroller.scrollTop;
      return;
    }

    const atBottom = isAtBottom(scroller);

    // Only a scrollTop decrease that happened shortly after a real user
    // gesture counts as "the user scrolled up". Anything else — scroll
    // anchoring kicking in because content above the fold resized,
    // sub-pixel jitter from fast re-renders, etc. — is ignored.
    const hasRecentUserIntent = Date.now() - lastUserIntentAtRef.current < USER_INTENT_WINDOW_MS;
    const scrolledUp = hasRecentUserIntent && scroller.scrollTop < lastScrollTopRef.current;

    const isFollowing = resolveFollowState({ atBottom, scrolledUp, isFollowing: isFollowingRef.current });

    lastScrollTopRef.current = scroller.scrollTop;

    if (isFollowing === isFollowingRef.current) return;
    isFollowingRef.current = isFollowing;
    setShowScrollToBottom(!isFollowing);
  }, []);

  const contentRef = useCallback<RefCallback<HTMLDivElement>>(
    (node) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node) return;

      const observer = new ResizeObserver(() => {
        if (!isFollowingRef.current) return;

        // Coalesce: if several ResizeObserver callbacks land in the same
        // frame (fast successive renders), only perform one write.
        if (pendingFollowWriteRafRef.current !== null) return;

        pendingFollowWriteRafRef.current = requestAnimationFrame(() => {
          pendingFollowWriteRafRef.current = null;
          const scroller = scrollRef.current;
          if (!scroller || !isFollowingRef.current) return;
          writeScrollTop(scroller, scroller.scrollHeight);
        });
      });

      observer.observe(node);
      observerRef.current = observer;
      scrollToBottom();
    },
    [scrollToBottom, writeScrollTop],
  );

  useEffect(() => {
    scrollToBottom();
  }, [resetKey, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (clearProgrammaticFlagRafRef.current !== null) cancelAnimationFrame(clearProgrammaticFlagRafRef.current);
      if (pendingFollowWriteRafRef.current !== null) cancelAnimationFrame(pendingFollowWriteRafRef.current);
    };
  }, []);

  return {
    scrollRef,
    contentRef,
    showScrollToBottom,
    handleScroll,
    scrollToBottom,
    onWheel: markUserIntent,
    onTouchStart: markUserIntent,
    onPointerDown: markUserIntent,
    onKeyDown,
  };
};

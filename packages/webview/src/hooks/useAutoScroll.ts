import { useCallback, useEffect, useRef, useState } from 'react';

import type { KeyboardEvent, PointerEvent, RefCallback, RefObject } from 'react';

export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export type ScrollDirection = 'up' | 'down';
export type ScrollTarget = 'top' | 'bottom';

// Distance from an edge that still counts as being at that edge.
export const AT_TOP_THRESHOLD_PX = 32;
export const AT_BOTTOM_THRESHOLD_PX = 32;

// How long after a real user gesture (wheel/touch/pointer/key) we still
// trust an upward scrollTop delta as intentional. Anything outside this
// window — layout shifts, browser scroll anchoring, our own corrective
// writes — must never be treated as "the user scrolled up".
const USER_INTENT_WINDOW_MS = 400;

// A press that moves less than this (in px) is a tap, not a scroll gesture.
const TAP_MOVE_THRESHOLD_PX = 4;

// Dragging the native scrollbar thumb emits scroll events but no pointer /
// wheel / key events on the container, so a non-trivial scrollTop delta is
// itself enough to identify a genuine scroll gesture.
export const MIN_GESTURE_DELTA_PX = 4;

export function isAtBottom(metrics: ScrollMetrics): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= AT_BOTTOM_THRESHOLD_PX;
}

export function isAtTop(metrics: ScrollMetrics): boolean {
  return metrics.scrollTop <= AT_TOP_THRESHOLD_PX;
}

export function resolveFollowState(params: { atBottom: boolean; scrolledUp: boolean; isFollowing: boolean }): boolean {
  if (params.atBottom) return true;
  if (!params.isFollowing) return false;
  return !params.scrolledUp;
}

// Returns the direction of a genuine scroll, or null for noise (a layout
// shift) that must not release follow or move the "scroll to ..." button.
export function resolveScrollGesture(params: { delta: number; hasRecentUserIntent: boolean }): ScrollDirection | null {
  if (params.delta === 0) return null;
  if (!params.hasRecentUserIntent && Math.abs(params.delta) < MIN_GESTURE_DELTA_PX) return null;
  return params.delta < 0 ? 'up' : 'down';
}

// A single "scroll to ..." button follows the direction of the last scroll:
// it offers the opposite edge once an edge is reached, and hides entirely at
// the bottom where there is nothing left to jump to.
export function resolveScrollTarget(params: {
  atBottom: boolean;
  atTop: boolean;
  isFollowing: boolean;
  lastDirection: ScrollDirection;
}): ScrollTarget | null {
  if (params.atBottom || params.isFollowing) return null;
  if (params.atTop) return 'bottom';
  return params.lastDirection === 'up' ? 'top' : 'bottom';
}

interface UseAutoScrollReturn {
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly contentRef: RefCallback<HTMLDivElement>;
  readonly scrollTarget: ScrollTarget | null;
  readonly handleScroll: () => void;
  readonly scrollTo: (target: ScrollTarget) => void;
  readonly scrollToBottom: () => void;
  readonly onWheel: () => void;
  readonly onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
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

  // The content ref attaches before the scroll container's ref, so the first
  // scroll of a freshly mounted chat has to wait a frame to be effective.
  const initialScrollRafRef = useRef<number | null>(null);

  // Timestamp of the last real, physical user input aimed at scrolling.
  const lastUserIntentAtRef = useRef(0);

  // Press start position, used to tell a tap (click) from a drag (scroll).
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  // Direction of the most recent genuine scroll gesture. Drives which edge
  // the "scroll to ..." button offers while the user is mid-conversation.
  const lastDirectionRef = useRef<ScrollDirection>('down');

  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | null>(null);

  const markUserIntent = useCallback((): void => {
    lastUserIntentAtRef.current = Date.now();
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (SCROLL_INTENT_KEYS.has(event.key)) markUserIntent();
    },
    [markUserIntent],
  );

  // A press opens the scroll-intent window, but a press without movement is a
  // tap, not a scroll. onPointerUp closes the window again for taps so the
  // layout shift from a click (e.g. answering a question) isn't read as scroll-up.
  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>): void => {
      pointerStartRef.current = { x: event.clientX, y: event.clientY };
      markUserIntent();
    },
    [markUserIntent],
  );

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dx * dx + dy * dy <= TAP_MOVE_THRESHOLD_PX * TAP_MOVE_THRESHOLD_PX) {
      lastUserIntentAtRef.current = 0;
    }
  }, []);

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

  const scrollTo = useCallback(
    (target: ScrollTarget): void => {
      const scroller = scrollRef.current;
      if (target === 'bottom') {
        isFollowingRef.current = true;
        setScrollTarget(null);
        if (scroller) writeScrollTop(scroller, scroller.scrollHeight);
      } else {
        isFollowingRef.current = false;
        lastDirectionRef.current = 'up';
        setScrollTarget('bottom');
        if (scroller) writeScrollTop(scroller, 0);
      }
    },
    [writeScrollTop],
  );

  const scrollToBottom = useCallback((): void => scrollTo('bottom'), [scrollTo]);

  const handleScroll = useCallback((): void => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    if (isProgrammaticScrollRef.current) {
      lastScrollTopRef.current = scroller.scrollTop;
      return;
    }

    const atBottom = isAtBottom(scroller);
    const atTop = isAtTop(scroller);

    // A gesture is either a recorded pointer/wheel/key input within the
    // intent window, or a scrollTop delta large enough to only come from a
    // user dragging the native scrollbar. Sub-pixel layout jitter is ignored.
    const hasRecentUserIntent = Date.now() - lastUserIntentAtRef.current < USER_INTENT_WINDOW_MS;
    const delta = scroller.scrollTop - lastScrollTopRef.current;
    const gesture = resolveScrollGesture({ delta, hasRecentUserIntent });

    if (gesture) {
      lastUserIntentAtRef.current = Date.now();
      lastDirectionRef.current = gesture;
    }

    isFollowingRef.current = resolveFollowState({ atBottom, scrolledUp: gesture === 'up', isFollowing: isFollowingRef.current });
    lastScrollTopRef.current = scroller.scrollTop;

    setScrollTarget(resolveScrollTarget({ atBottom, atTop, isFollowing: isFollowingRef.current, lastDirection: lastDirectionRef.current }));
  }, []);

  const contentRef = useCallback<RefCallback<HTMLDivElement>>(
    (node) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (initialScrollRafRef.current !== null) {
        cancelAnimationFrame(initialScrollRafRef.current);
        initialScrollRafRef.current = null;
      }
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

      // refs are attached child-first, so scrollRef is still null here.
      // Deferring one frame makes this work even when resetKey is unchanged
      // (e.g. reopening the same task from the history view).
      initialScrollRafRef.current = requestAnimationFrame(() => {
        initialScrollRafRef.current = null;
        scrollToBottom();
      });
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
      if (initialScrollRafRef.current !== null) cancelAnimationFrame(initialScrollRafRef.current);
    };
  }, []);

  return {
    scrollRef,
    contentRef,
    scrollTarget,
    handleScroll,
    scrollTo,
    scrollToBottom,
    onWheel: markUserIntent,
    onPointerDown,
    onPointerUp,
    onKeyDown,
  };
};

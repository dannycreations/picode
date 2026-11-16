import { act, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  AT_BOTTOM_THRESHOLD_PX,
  AT_TOP_THRESHOLD_PX,
  isAtBottom,
  isAtTop,
  MIN_GESTURE_DELTA_PX,
  resolveFollowState,
  resolveScrollGesture,
  resolveScrollTarget,
  useAutoScroll,
} from '@pi-code/webview/hooks/useAutoScroll';

import type { ScrollDirection, ScrollMetrics } from '@pi-code/webview/hooks/useAutoScroll';

function createMetrics(overrides: Partial<ScrollMetrics> = {}): ScrollMetrics {
  return { scrollTop: 900, scrollHeight: 1400, clientHeight: 500, ...overrides };
}

describe('isAtBottom', () => {
  it('should treat an exact bottom as at the bottom', () => {
    expect(isAtBottom(createMetrics())).toBe(true);
  });

  it('should tolerate sub-pixel and rounding drift up to the threshold', () => {
    expect(isAtBottom(createMetrics({ scrollTop: 900 - AT_BOTTOM_THRESHOLD_PX }))).toBe(true);
    expect(isAtBottom(createMetrics({ scrollTop: 900 - AT_BOTTOM_THRESHOLD_PX - 1 }))).toBe(false);
  });

  it('should report the top of a long conversation as away from the bottom', () => {
    expect(isAtBottom(createMetrics({ scrollTop: 0 }))).toBe(false);
  });

  it('should report content shorter than the viewport as at the bottom', () => {
    expect(isAtBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 500 })).toBe(true);
  });
});

describe('isAtTop', () => {
  it('should treat the exact top as at the top', () => {
    expect(isAtTop(createMetrics({ scrollTop: 0 }))).toBe(true);
  });

  it('should tolerate drift up to the threshold', () => {
    expect(isAtTop(createMetrics({ scrollTop: AT_TOP_THRESHOLD_PX }))).toBe(true);
    expect(isAtTop(createMetrics({ scrollTop: AT_TOP_THRESHOLD_PX + 1 }))).toBe(false);
  });
});

describe('resolveFollowState', () => {
  it('should re-engage follow whenever the user reaches the bottom', () => {
    expect(resolveFollowState({ atBottom: true, scrolledUp: false, isFollowing: false })).toBe(true);
    expect(resolveFollowState({ atBottom: true, scrolledUp: true, isFollowing: false })).toBe(true);
  });

  it('should release follow only on an explicit upward scroll while following', () => {
    expect(resolveFollowState({ atBottom: false, scrolledUp: true, isFollowing: true })).toBe(false);
  });

  it('should keep following while already at the bottom or scrolling down', () => {
    expect(resolveFollowState({ atBottom: false, scrolledUp: false, isFollowing: true })).toBe(true);
  });

  it('should stay released once the user has scrolled away from the bottom', () => {
    expect(resolveFollowState({ atBottom: false, scrolledUp: false, isFollowing: false })).toBe(false);
  });
});

describe('resolveScrollGesture', () => {
  it('should read direction from a recorded gesture, however small the delta', () => {
    expect(resolveScrollGesture({ delta: -1, hasRecentUserIntent: true })).toBe('up');
    expect(resolveScrollGesture({ delta: 1, hasRecentUserIntent: true })).toBe('down');
  });

  it('should read direction from a scrollbar drag without a recorded gesture', () => {
    expect(resolveScrollGesture({ delta: -MIN_GESTURE_DELTA_PX, hasRecentUserIntent: false })).toBe('up');
    expect(resolveScrollGesture({ delta: MIN_GESTURE_DELTA_PX, hasRecentUserIntent: false })).toBe('down');
  });

  it('should ignore layout jitter below the threshold without a gesture', () => {
    expect(resolveScrollGesture({ delta: -(MIN_GESTURE_DELTA_PX - 1), hasRecentUserIntent: false })).toBeNull();
    expect(resolveScrollGesture({ delta: 0, hasRecentUserIntent: true })).toBeNull();
  });
});

describe('resolveScrollTarget', () => {
  const target = (atBottom: boolean, atTop: boolean, isFollowing: boolean, lastDirection: ScrollDirection) =>
    resolveScrollTarget({ atBottom, atTop, isFollowing, lastDirection });

  it('should hide the button at the bottom and while following', () => {
    expect(target(true, false, false, 'up')).toBeNull();
    expect(target(false, false, true, 'up')).toBeNull();
  });

  it('should offer the bottom once the top is reached', () => {
    expect(target(false, true, false, 'up')).toBe('bottom');
    expect(target(false, true, false, 'down')).toBe('bottom');
  });

  it('should follow the last gesture while mid-conversation', () => {
    expect(target(false, false, false, 'up')).toBe('top');
    expect(target(false, false, false, 'down')).toBe('bottom');
  });
});

describe('useAutoScroll initial mount', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('scrolls to the bottom when the viewport mounts without a reset-key change', async () => {
    function Harness({ show }: { show: boolean }) {
      const { scrollRef, contentRef } = useAutoScroll('task-1');
      return createElement(
        'div',
        null,
        show ? createElement('div', { ref: scrollRef, 'data-testid': 'scroller' }, createElement('div', { ref: contentRef })) : null,
      );
    }

    const view = render(createElement(Harness, { show: false }));
    view.rerender(createElement(Harness, { show: true }));

    const scroller = screen.getByTestId('scroller');
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(scroller.scrollTop).toBe(1000);
  });
});

import { describe, expect, it } from 'vitest';

import { AT_BOTTOM_THRESHOLD_PX, hasScrolledAwayFromPin, isAtBottom, shouldReleaseFollow } from '@extension/webview/hooks/useAutoScroll';

import type { ScrollMetrics } from '@extension/webview/hooks/useAutoScroll';

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

describe('hasScrolledAwayFromPin', () => {
  it('should ignore layout noise within the tolerance', () => {
    expect(hasScrolledAwayFromPin(900, 900)).toBe(false);
    expect(hasScrolledAwayFromPin(898, 900)).toBe(false);
  });

  it('should detect a deliberate scroll upward', () => {
    expect(hasScrolledAwayFromPin(800, 900)).toBe(true);
  });

  it('should never trigger on downward movement', () => {
    expect(hasScrolledAwayFromPin(1000, 900)).toBe(false);
  });
});

describe('shouldReleaseFollow', () => {
  it('should keep following when new output is appended below the viewport', () => {
    // Output grew by 500px: the gap to the bottom is large, but scrollTop has
    // not moved, so the user is still parked where we last pinned them.
    const metrics = createMetrics({ scrollTop: 900, scrollHeight: 1900 });

    expect(isAtBottom(metrics)).toBe(false);
    expect(shouldReleaseFollow(metrics, 900)).toBe(false);
  });

  it('should stop following when the user scrolls up by the same amount', () => {
    const metrics = createMetrics({ scrollTop: 400, scrollHeight: 1400 });

    expect(shouldReleaseFollow(metrics, 900)).toBe(true);
  });

  it('should keep following when shrinking content clamps the scroll position', () => {
    // Collapsing an expanded diff shortens the list and the browser clamps
    // scrollTop. That lands above the last pin but is still the bottom.
    const metrics = createMetrics({ scrollTop: 300, scrollHeight: 800 });

    expect(isAtBottom(metrics)).toBe(true);
    expect(shouldReleaseFollow(metrics, 900)).toBe(false);
  });
});

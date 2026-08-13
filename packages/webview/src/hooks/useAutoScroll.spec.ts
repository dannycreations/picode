import { describe, expect, it } from 'vitest';

import { AT_BOTTOM_THRESHOLD_PX, isAtBottom, resolveFollowState } from '@pi-code/webview/hooks/useAutoScroll';

import type { ScrollMetrics } from '@pi-code/webview/hooks/useAutoScroll';

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

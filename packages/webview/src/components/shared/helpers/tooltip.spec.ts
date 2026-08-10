import { describe, expect, it } from 'vitest';

import { computeTooltipPlacement } from '@pi-code/webview/components/shared/helpers/tooltip';

import type { TooltipRect, TooltipSize } from '@pi-code/webview/components/shared/helpers/tooltip';

const VIEWPORT: TooltipSize = { width: 400, height: 300 };
const TOOLTIP: TooltipSize = { width: 100, height: 30 };

function anchorAt(left: number, top: number, width = 20, height = 20): TooltipRect {
  return { left, top, width, height };
}

describe('computeTooltipPlacement', () => {
  it('should keep the requested side when the tooltip fits', () => {
    expect(
      computeTooltipPlacement({
        anchor: anchorAt(150, 150),
        tooltip: TOOLTIP,
        viewport: VIEWPORT,
        side: 'top',
      }),
    ).toEqual({ side: 'top', left: 110, top: 112, arrow: 50 });
  });

  it('should default to the top side', () => {
    const placement = computeTooltipPlacement({ anchor: anchorAt(150, 150), tooltip: TOOLTIP, viewport: VIEWPORT });
    expect(placement.side).toBe('top');
  });

  it('should flip to the opposite side when the requested one is too tight', () => {
    expect(
      computeTooltipPlacement({
        anchor: anchorAt(150, 20),
        tooltip: TOOLTIP,
        viewport: VIEWPORT,
        side: 'top',
      }),
    ).toEqual({ side: 'bottom', left: 110, top: 48, arrow: 50 });

    expect(
      computeTooltipPlacement({
        anchor: anchorAt(380, 140),
        tooltip: TOOLTIP,
        viewport: VIEWPORT,
        side: 'right',
      }),
    ).toEqual({ side: 'left', left: 272, top: 135, arrow: 15 });
  });

  it('should shift along the cross axis to stay inside the viewport', () => {
    expect(
      computeTooltipPlacement({
        anchor: anchorAt(0, 150),
        tooltip: TOOLTIP,
        viewport: VIEWPORT,
        side: 'top',
      }),
    ).toMatchObject({ side: 'top', left: 6 });

    expect(
      computeTooltipPlacement({
        anchor: anchorAt(380, 150),
        tooltip: TOOLTIP,
        viewport: VIEWPORT,
        side: 'top',
      }),
    ).toMatchObject({ side: 'top', left: 294 });
  });

  it('should move the arrow so it keeps pointing at a shifted anchor', () => {
    // Anchor centre sits at 10px, left of where a centred tooltip could reach,
    // so the arrow is pinned one arrow-width away from the rounded corner.
    expect(computeTooltipPlacement({ anchor: anchorAt(0, 150), tooltip: TOOLTIP, viewport: VIEWPORT, side: 'top' }).arrow).toBe(8);
    expect(computeTooltipPlacement({ anchor: anchorAt(380, 150), tooltip: TOOLTIP, viewport: VIEWPORT, side: 'top' }).arrow).toBe(92);
  });

  it('should centre the arrow when the tooltip is too small for corner margins', () => {
    expect(
      computeTooltipPlacement({
        anchor: anchorAt(0, 150),
        tooltip: { width: 12, height: 12 },
        viewport: VIEWPORT,
        side: 'top',
      }).arrow,
    ).toBe(6);
  });

  it('should place a horizontal tooltip beside the anchor and centre it vertically', () => {
    expect(
      computeTooltipPlacement({
        anchor: anchorAt(100, 140),
        tooltip: TOOLTIP,
        viewport: VIEWPORT,
        side: 'right',
      }),
    ).toEqual({ side: 'right', left: 128, top: 135, arrow: 15 });
  });

  it('should fall back to the roomiest side when nothing fits', () => {
    expect(
      computeTooltipPlacement({
        anchor: anchorAt(100, 50),
        tooltip: { width: 200, height: 100 },
        viewport: { width: 220, height: 120 },
        side: 'top',
      }),
    ).toEqual({ side: 'right', left: 14, top: 10, arrow: 50 });
  });

  it('should never position the tooltip outside the viewport padding', () => {
    const placement = computeTooltipPlacement({
      anchor: anchorAt(-40, -40),
      tooltip: TOOLTIP,
      viewport: VIEWPORT,
      side: 'top',
    });

    expect(placement.left).toBeGreaterThanOrEqual(6);
    expect(placement.top).toBeGreaterThanOrEqual(6);
    expect(placement.left + TOOLTIP.width).toBeLessThanOrEqual(VIEWPORT.width - 6);
    expect(placement.top + TOOLTIP.height).toBeLessThanOrEqual(VIEWPORT.height - 6);
  });

  it('should honour custom offset, padding and arrow sizing', () => {
    expect(
      computeTooltipPlacement({
        anchor: anchorAt(150, 150),
        tooltip: TOOLTIP,
        viewport: VIEWPORT,
        side: 'bottom',
        offset: 12,
        padding: 0,
        arrowSize: 20,
      }),
    ).toEqual({ side: 'bottom', left: 110, top: 182, arrow: 50 });
  });

  it('should round fractional coordinates', () => {
    const placement = computeTooltipPlacement({
      anchor: anchorAt(150, 150, 21, 21),
      tooltip: { width: 101, height: 31 },
      viewport: VIEWPORT,
      side: 'top',
    });

    expect(Number.isInteger(placement.left)).toBe(true);
    expect(Number.isInteger(placement.top)).toBe(true);
    expect(Number.isInteger(placement.arrow)).toBe(true);
  });
});

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipSize {
  readonly width: number;
  readonly height: number;
}

export interface TooltipRect extends TooltipSize {
  readonly left: number;
  readonly top: number;
}

interface TooltipPlacementInput {
  readonly anchor: TooltipRect;
  readonly tooltip: TooltipSize;
  readonly viewport: TooltipSize;
  readonly side?: TooltipSide;
  readonly offset?: number;
  readonly padding?: number;
  readonly arrowSize?: number;
}

export interface TooltipPlacement {
  readonly side: TooltipSide;
  readonly left: number;
  readonly top: number;
  readonly arrow: number;
}

// Gap kept between the anchor and the tooltip; the arrow lives inside it.
const TOOLTIP_OFFSET = 8;
// Smallest gap kept between the tooltip and the viewport edges.
const TOOLTIP_PADDING = 6;
// Side length of the square that is rotated 45deg to draw the arrow.
export const TOOLTIP_ARROW_SIZE = 8;

// Preferred side first, then its opposite, then the perpendicular axis. Trying
// the opposite side before the perpendicular ones keeps the tooltip on the axis
// the caller asked for whenever that is at all possible.
const SIDE_FALLBACKS: Record<TooltipSide, readonly TooltipSide[]> = {
  top: ['top', 'bottom', 'right', 'left'],
  bottom: ['bottom', 'top', 'right', 'left'],
  left: ['left', 'right', 'top', 'bottom'],
  right: ['right', 'left', 'top', 'bottom'],
};

function clamp(value: number, min: number, max: number): number {
  // A viewport too small for the tooltip inverts the range, and pinning to the
  // start edge degrades better than letting the tooltip drift off-screen.
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function getFreeSpace(side: TooltipSide, anchor: TooltipRect, viewport: TooltipSize, padding: number): number {
  switch (side) {
    case 'top':
      return anchor.top - padding;
    case 'bottom':
      return viewport.height - (anchor.top + anchor.height) - padding;
    case 'left':
      return anchor.left - padding;
    case 'right':
      return viewport.width - (anchor.left + anchor.width) - padding;
  }
}

function getMainSize(side: TooltipSide, tooltip: TooltipSize): number {
  return side === 'top' || side === 'bottom' ? tooltip.height : tooltip.width;
}

export function computeTooltipPlacement({
  anchor,
  tooltip,
  viewport,
  side = 'top',
  offset = TOOLTIP_OFFSET,
  padding = TOOLTIP_PADDING,
  arrowSize = TOOLTIP_ARROW_SIZE,
}: TooltipPlacementInput): TooltipPlacement {
  const candidates = SIDE_FALLBACKS[side];

  let resolved = candidates[0];
  let widestSpace = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const free = getFreeSpace(candidate, anchor, viewport, padding) - offset;
    if (free >= getMainSize(candidate, tooltip)) {
      resolved = candidate;
      widestSpace = Number.POSITIVE_INFINITY;
      break;
    }
    // Nothing fits so far, so remember the least bad side.
    if (free > widestSpace) {
      widestSpace = free;
      resolved = candidate;
    }
  }

  const isVertical = resolved === 'top' || resolved === 'bottom';
  const anchorCenterX = anchor.left + anchor.width / 2;
  const anchorCenterY = anchor.top + anchor.height / 2;

  let left: number;
  let top: number;

  if (isVertical) {
    const mainTop = resolved === 'top' ? anchor.top - offset - tooltip.height : anchor.top + anchor.height + offset;
    top = clamp(mainTop, padding, viewport.height - tooltip.height - padding);
    left = clamp(anchorCenterX - tooltip.width / 2, padding, viewport.width - tooltip.width - padding);
  } else {
    const mainLeft = resolved === 'left' ? anchor.left - offset - tooltip.width : anchor.left + anchor.width + offset;
    left = clamp(mainLeft, padding, viewport.width - tooltip.width - padding);
    top = clamp(anchorCenterY - tooltip.height / 2, padding, viewport.height - tooltip.height - padding);
  }

  const crossSize = isVertical ? tooltip.width : tooltip.height;
  const anchorCenter = isVertical ? anchorCenterX : anchorCenterY;
  const crossStart = isVertical ? left : top;

  // Keep the arrow clear of the rounded corners, and centre it when the tooltip
  // is too small to hold both margins.
  const maxArrow = crossSize - arrowSize;
  const arrow = maxArrow <= arrowSize ? crossSize / 2 : clamp(anchorCenter - crossStart, arrowSize, maxArrow);

  return {
    side: resolved,
    left: Math.round(left),
    top: Math.round(top),
    arrow: Math.round(arrow),
  };
}

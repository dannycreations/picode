import { cn } from 'cnfast';
import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { computeTooltipPlacement, TOOLTIP_ARROW_SIZE } from '@pi-code/webview/components/shared/helpers/tooltip';

import type { CSSProperties, FC, FocusEvent, PointerEvent, ReactElement, ReactNode, Ref } from 'react';
import type { TooltipPlacement, TooltipSide } from '@pi-code/webview/components/shared/helpers/tooltip';

// Long enough that the tooltip does not chase the pointer across a toolbar.
const OPEN_DELAY_MS = 400;

const ARROW_INSET = TOOLTIP_ARROW_SIZE / 2;

const ARROW_BORDERS: Record<TooltipSide, string> = {
  top: 'border-r border-b',
  bottom: 'border-l border-t',
  left: 'border-t border-r',
  right: 'border-b border-l',
};

interface TooltipAnchorProps {
  readonly ref?: Ref<HTMLElement | null>;
  readonly onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  readonly onFocus?: (event: FocusEvent<HTMLElement>) => void;
  readonly onBlur?: (event: FocusEvent<HTMLElement>) => void;
  readonly 'aria-describedby'?: string;
}

interface TooltipProps {
  readonly content?: ReactNode;
  readonly side?: TooltipSide;
  readonly disabled?: boolean;
  readonly children: ReactElement<TooltipAnchorProps>;
}

function getArrowStyle(placement: TooltipPlacement): CSSProperties {
  switch (placement.side) {
    case 'top':
      return { left: placement.arrow - ARROW_INSET, bottom: -ARROW_INSET };
    case 'bottom':
      return { left: placement.arrow - ARROW_INSET, top: -ARROW_INSET };
    case 'left':
      return { top: placement.arrow - ARROW_INSET, right: -ARROW_INSET };
    case 'right':
      return { top: placement.arrow - ARROW_INSET, left: -ARROW_INSET };
  }
}

export const Tooltip: FC<TooltipProps> = ({ content, side = 'top', disabled = false, children }) => {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isOpen, setOpen] = useState(false);
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);

  const hasContent = content !== undefined && content !== null && content !== false && content !== '';
  const isVisible = isOpen && hasContent && !disabled;

  const cancelTimer = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(
    (immediate: boolean): void => {
      cancelTimer();
      if (immediate) {
        setOpen(true);
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setOpen(true);
      }, OPEN_DELAY_MS);
    },
    [cancelTimer],
  );

  const hide = useCallback((): void => {
    cancelTimer();
    setOpen(false);
  }, [cancelTimer]);

  useEffect(() => cancelTimer, [cancelTimer]);

  // Measuring before paint keeps the tooltip from flashing at the wrong spot,
  // and re-running on scroll or resize keeps it glued to a moving anchor.
  useLayoutEffect(() => {
    if (!isVisible) return;

    const reposition = (): void => {
      const anchor = anchorRef.current;
      const tooltip = tooltipRef.current;
      if (!anchor || !tooltip) return;

      const rect = anchor.getBoundingClientRect();
      const next = computeTooltipPlacement({
        anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        tooltip: { width: tooltip.offsetWidth, height: tooltip.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        side,
      });

      setPlacement((prev) =>
        prev && prev.side === next.side && prev.left === next.left && prev.top === next.top && prev.arrow === next.arrow ? prev : next,
      );
    };

    reposition();

    // Capture catches scrolling in any ancestor, not just the window.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [isVisible, side, content]);

  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isVisible, hide]);

  const anchorProps = children.props;
  const childRef = anchorProps.ref;

  const setAnchor = useCallback(
    (node: HTMLElement | null): void => {
      anchorRef.current = node;
      if (typeof childRef === 'function') {
        childRef(node);
      } else if (childRef) {
        childRef.current = node;
      }
    },
    [childRef],
  );

  const trigger = cloneElement<TooltipAnchorProps>(children, {
    ref: setAnchor,
    'aria-describedby': isVisible ? tooltipId : anchorProps['aria-describedby'],
    onPointerEnter: (event) => {
      anchorProps.onPointerEnter?.(event);
      // Touch reports an enter right before the tap, which would leave a
      // tooltip hanging over the control the user just pressed.
      if (event.pointerType !== 'touch') show(false);
    },
    onPointerLeave: (event) => {
      anchorProps.onPointerLeave?.(event);
      hide();
    },
    onPointerDown: (event) => {
      anchorProps.onPointerDown?.(event);
      hide();
    },
    onFocus: (event) => {
      anchorProps.onFocus?.(event);
      // Only keyboard focus should reveal the tooltip; a click already had its
      // chance through hover.
      if (event.currentTarget.matches(':focus-visible')) show(true);
    },
    onBlur: (event) => {
      anchorProps.onBlur?.(event);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {isVisible &&
        createPortal(
          <div
            ref={tooltipRef}
            id={tooltipId}
            role="tooltip"
            style={{
              left: placement?.left ?? 0,
              top: placement?.top ?? 0,
              visibility: placement ? 'visible' : 'hidden',
            }}
            className={cn(
              'fixed z-[2000] w-max max-w-[280px] rounded px-2 py-1 text-xs leading-snug text-balance shadow-md pointer-events-none select-none',
              'border border-vscode-editorHoverWidget-border bg-vscode-editorHoverWidget-background text-vscode-editorHoverWidget-foreground',
              placement && 'animate-tooltip-in',
            )}
          >
            {content}
            {placement && (
              <span
                aria-hidden="true"
                style={getArrowStyle(placement)}
                className={cn(
                  'absolute h-2 w-2 rotate-45 border-vscode-editorHoverWidget-border bg-vscode-editorHoverWidget-background',
                  ARROW_BORDERS[placement.side],
                )}
              />
            )}
          </div>,
          document.body,
        )}
    </>
  );
};

import { useEffect, useRef, useState } from 'react';

import type { RefObject } from 'react';

interface UseResponsiveReturn {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly isCollapsed: boolean;
  readonly shouldAnimate: boolean;
}

const COLLAPSE_THRESHOLD_PX = 550;

export const useResponsive = (): UseResponsiveReturn => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(() => window.innerWidth < COLLAPSE_THRESHOLD_PX);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setIsCollapsed(entry.contentRect.width < COLLAPSE_THRESHOLD_PX);
      }
    });

    observer.observe(container);
    // Arm the collapse animation after the first paint so
    // opening is instant and later resizes animate.
    const frame = requestAnimationFrame(() => setShouldAnimate(true));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return { containerRef, isCollapsed, shouldAnimate };
};

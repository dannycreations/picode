import { useEffect, useRef, useState } from 'react';

import type { RefObject } from 'react';

interface UseResponsiveReturn {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly isCollapsed: boolean;
  readonly shouldAnimate: boolean;
}

export const useResponsive = (threshold: number): UseResponsiveReturn => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(() => window.innerWidth < threshold);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setIsCollapsed(entry.contentRect.width < threshold);
      }
    });

    observer.observe(container);
    // Arm the collapse animation after the first paint so
    // opening is instant and later resizes animate.
    requestAnimationFrame(() => setShouldAnimate(true));
    return () => observer.disconnect();
  }, [threshold]);

  return { containerRef, isCollapsed, shouldAnimate };
};

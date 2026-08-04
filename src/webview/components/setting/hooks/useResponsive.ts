import { useEffect, useRef, useState } from 'react';

export const useResponsive = (threshold = 600, active = true) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setIsCollapsed(entry.contentRect.width < threshold);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [active, threshold]);

  return { containerRef, isCollapsed };
};

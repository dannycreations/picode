import { useEffect, useRef, useState } from 'react';

import type { RefObject } from 'react';

// How far outside the viewport content starts preparing itself.
const PREFETCH_MARGIN_PX = 600;

interface UseInViewportReturn<T extends Element> {
  readonly ref: RefObject<T | null>;
  readonly hasBeenVisible: boolean;
}

export function useInViewport<T extends Element>(): UseInViewportReturn<T> {
  const ref = useRef<T>(null);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);

  useEffect(() => {
    if (hasBeenVisible) return;

    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setHasBeenVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasBeenVisible(true);
        }
      },
      { rootMargin: `${PREFETCH_MARGIN_PX}px 0px` },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasBeenVisible]);

  return { ref, hasBeenVisible };
}

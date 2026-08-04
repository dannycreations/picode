import { useEffect } from 'react';

import type { RefObject } from 'react';

export function useClickOutside<T extends HTMLElement>(ref: RefObject<T | null>, handler: () => void): void {
  useEffect(() => {
    const listener = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        handler();
      }
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler]);
}

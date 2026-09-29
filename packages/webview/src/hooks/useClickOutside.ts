import { useEffect, useRef } from 'react';

import type { RefObject } from 'react';

export const useClickOutside = <T extends HTMLElement>(ref: RefObject<T | null>, handler: () => void): void => {
  // Every caller passes an inline closure, so depending on `handler` would
  // re-add the document listener on every render. A ref keeps the latest
  // handler without resubscribing.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        handlerRef.current();
      }
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref]);
};

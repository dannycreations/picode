import { useEffect, useRef, useState } from 'react';

export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    if (Object.is(throttled, value)) return;

    const elapsed = Date.now() - lastUpdateRef.current;
    if (elapsed >= intervalMs) {
      lastUpdateRef.current = Date.now();
      setThrottled(value);
      return;
    }

    // A pending refresh is dropped when the value changes again, so the value
    // that lands is always the most recent one the interval allows.
    const handle = setTimeout(() => {
      lastUpdateRef.current = Date.now();
      setThrottled(value);
    }, intervalMs - elapsed);
    return () => clearTimeout(handle);
  }, [value, throttled, intervalMs]);

  return throttled;
}

import { useEffect, useState } from 'react';

export function useElapsedSeconds(startTs: number, isActive: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isActive]);

  return Math.max(0, Math.floor((now - startTs) / 1000));
}

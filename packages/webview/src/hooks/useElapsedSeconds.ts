import { useEffect, useState } from 'react';

export function useElapsedSeconds(startTs: number, isActive: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(() => {
    return isActive ? Date.now() - startTs : 0;
  });

  useEffect(() => {
    setElapsedMs(isActive ? Date.now() - startTs : 0);
  }, [startTs]);

  useEffect(() => {
    if (!isActive) return;
    const runStart = Date.now() - elapsedMs;
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - runStart);
    }, 200);
    return () => clearInterval(timer);
  }, [isActive]);

  return Math.max(0, Math.floor(elapsedMs / 1000));
}

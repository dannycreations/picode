import { useEffect, useState } from 'react';

export const useElapsedSeconds = (startTs: number, isActive: boolean): number => {
  const [elapsedMs, setElapsedMs] = useState(() => (isActive ? Date.now() - startTs : 0));

  useEffect(() => {
    if (!isActive) {
      setElapsedMs(0);
      return;
    }
    setElapsedMs(Date.now() - startTs);
    const timer = setInterval(() => setElapsedMs(Date.now() - startTs), 200);
    return () => clearInterval(timer);
  }, [isActive, startTs]);

  return Math.max(0, Math.floor(elapsedMs / 1000));
};

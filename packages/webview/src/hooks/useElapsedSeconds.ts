import { useEffect, useState } from 'react';

import { elapsedSeconds } from '@pi-code/shared/utilities/common';

export const useElapsedSeconds = (startTs: number, isActive: boolean): number => {
  const [seconds, setSeconds] = useState(() => (isActive ? elapsedSeconds(startTs) : 0));

  useEffect(() => {
    if (!isActive) {
      setSeconds(0);
      return;
    }
    setSeconds(elapsedSeconds(startTs));
    const timer = setInterval(() => setSeconds(elapsedSeconds(startTs)), 200);
    return () => clearInterval(timer);
  }, [isActive, startTs]);

  return seconds;
};

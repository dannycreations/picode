import { useEffect, useState } from 'react';

import { remainingSeconds } from '@pi-code/shared/utilities/common';

export const useCountdown = (deadline: number | undefined): number | undefined => {
  const [seconds, setSeconds] = useState(() => (deadline === undefined ? undefined : remainingSeconds(deadline)));

  useEffect(() => {
    if (deadline === undefined) {
      setSeconds(undefined);
      return;
    }
    setSeconds(remainingSeconds(deadline));
    const timer = setInterval(() => {
      const left = remainingSeconds(deadline);
      setSeconds(left);
      // The wait is over once nothing is left, so the timer stops instead of
      // re-rendering the row every tick for no change.
      if (left === 0) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, [deadline]);

  return seconds;
};

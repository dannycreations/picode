import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from '@pi-code/shared/core/logger';

import type { MouseEvent } from 'react';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Failed to copy to clipboard');
    logger.error('Failed to copy to clipboard:', err);
    return false;
  }
}

interface UseCopyToClipboardReturn {
  readonly showCopy: boolean;
  readonly copy: (text: string, e?: MouseEvent) => Promise<boolean>;
}

export const useCopyToClipboard = (feedbackDuration = 2000): UseCopyToClipboardReturn => {
  const [showCopy, setShowCopy] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const copy = useCallback(
    async (text: string, e?: MouseEvent): Promise<boolean> => {
      e?.stopPropagation();

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      const success = await copyToClipboard(text);
      if (success) {
        setShowCopy(true);
        timeoutRef.current = setTimeout(() => {
          setShowCopy(false);
          timeoutRef.current = null;
        }, feedbackDuration);
      }

      return success;
    },
    [feedbackDuration],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    showCopy,
    copy,
  };
};

import { useCallback, useEffect, useRef, useState } from 'react';

import type { MouseEvent } from 'react';

interface CopyOptions {
  readonly feedbackDuration?: number;
  readonly onSuccess?: () => void;
  readonly onError?: (error: Error) => void;
}

export async function copyToClipboard(text: string, options?: CopyOptions): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    options?.onSuccess?.();
    return true;
  } catch (error) {
    const err = error instanceof Error ? error : new Error('Failed to copy to clipboard');
    options?.onError?.(err);
    console.error('Failed to copy to clipboard:', err);
    return false;
  }
}

export interface UseCopyToClipboardReturn {
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

      const success = await copyToClipboard(text, {
        onSuccess: () => {
          setShowCopy(true);
          timeoutRef.current = setTimeout(() => {
            setShowCopy(false);
            timeoutRef.current = null;
          }, feedbackDuration);
        },
      });

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

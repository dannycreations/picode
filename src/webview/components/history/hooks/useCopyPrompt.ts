import { useCallback, useState } from 'react';

import type { MouseEvent } from 'react';

export interface UseCopyPromptReturn {
  readonly copiedPath: string | null;
  readonly copyToClipboard: (e: MouseEvent, text: string, path: string) => void;
}

export const useCopyPrompt = (timeoutMs = 2000): UseCopyPromptReturn => {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const copyToClipboard = useCallback(
    (e: MouseEvent, text: string, path: string): void => {
      e.stopPropagation();
      navigator.clipboard.writeText(text);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), timeoutMs);
    },
    [timeoutMs],
  );

  return { copiedPath, copyToClipboard };
};

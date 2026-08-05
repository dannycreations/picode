import { useCallback, useState } from 'react';

import type { MouseEvent } from 'react';

export const useCopyPrompt = (timeoutMs = 2000) => {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const copyToClipboard = useCallback(
    (e: MouseEvent, text: string, path: string) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), timeoutMs);
    },
    [timeoutMs],
  );

  return { copiedPath, copyToClipboard };
};

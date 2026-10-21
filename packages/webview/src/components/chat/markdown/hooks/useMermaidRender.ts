import mermaid from 'mermaid-compact';
import { useEffect, useState } from 'react';

import { logger } from '@pi-code/shared/core/logger';
import { ensureMermaidInitialized } from '@pi-code/webview/components/chat/markdown/helpers/mermaid';

const RENDER_DEBOUNCE_MS = 500;

interface UseMermaidRenderReturn {
  readonly code: string;
  readonly svgContent: string;
  readonly isLoading: boolean;
  readonly error: string | null;
}

export const useMermaidRender = (originalCode: string, enabled: boolean): UseMermaidRenderReturn => {
  const [svgContent, setSvgContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The error belongs to the previous code, so it is cleared as soon as the
    // new code starts loading.
    setError(null);
    if (!enabled) return;
    setIsLoading(true);

    let cancelled = false;
    const timer = setTimeout(() => {
      ensureMermaidInitialized();
      const id = `mermaid-${Math.random().toString(36).substring(2)}`;
      mermaid
        .parse(originalCode)
        .then(() => mermaid.render(id, originalCode))
        .then(({ svg }) => {
          if (cancelled) return;
          setSvgContent(svg);
        })
        .catch((err) => {
          if (cancelled) return;
          logger.warn('Mermaid parse/render failed:', err);
          setError(err instanceof Error ? err.message : 'Mermaid render error');
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, RENDER_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [originalCode, enabled]);

  return {
    code: originalCode,
    svgContent,
    isLoading,
    error,
  };
};

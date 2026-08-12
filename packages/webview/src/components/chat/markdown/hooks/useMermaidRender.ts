import mermaid from 'mermaid-compact';
import { useCallback, useEffect, useState } from 'react';

import { logger } from '@pi-code/shared/core/logger';
import { applyDeterministicFixes, ensureMermaidInitialized } from '@pi-code/webview/components/chat/markdown/helpers/mermaid';

const RENDER_DEBOUNCE_MS = 500;

interface UseMermaidRenderReturn {
  readonly code: string;
  readonly svgContent: string;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly handleSyntaxFix: () => void;
}

export const useMermaidRender = (originalCode: string, enabled: boolean): UseMermaidRenderReturn => {
  const [code, setCode] = useState(originalCode);
  const [svgContent, setSvgContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCode(originalCode);
    setError(null);
  }, [originalCode]);

  useEffect(() => {
    if (!enabled) return;
    setIsLoading(true);

    const timer = setTimeout(() => {
      ensureMermaidInitialized();
      const id = `mermaid-${Math.random().toString(36).substring(2)}`;
      mermaid
        .parse(code)
        .then(() => mermaid.render(id, code))
        .then(({ svg }) => {
          setError(null);
          setSvgContent(svg);
        })
        .catch((err) => {
          logger.warn('Mermaid parse/render failed:', err);
          setError(err instanceof Error ? err.message : 'Mermaid render error');
        })
        .finally(() => setIsLoading(false));
    }, RENDER_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [code, enabled]);

  const handleSyntaxFix = useCallback((): void => {
    const fixed = applyDeterministicFixes(code);
    setCode(fixed);
  }, [code]);

  return {
    code,
    svgContent,
    isLoading,
    error,
    handleSyntaxFix,
  };
};

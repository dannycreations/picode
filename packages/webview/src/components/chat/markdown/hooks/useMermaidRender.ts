import mermaid from 'mermaid-compact';
import { useCallback, useEffect, useState } from 'react';

import { logger } from '@pi-code/shared/core/logger';
import { applyDeterministicFixes } from '@pi-code/webview/components/chat/markdown/helpers/mermaid';

export interface UseMermaidRenderReturn {
  readonly code: string;
  readonly svgContent: string;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly isFixing: boolean;
  readonly handleSyntaxFix: () => void;
}

export const useMermaidRender = (originalCode: string, enabled: boolean): UseMermaidRenderReturn => {
  const [code, setCode] = useState(originalCode);
  const [svgContent, setSvgContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCode(originalCode);
    setError(null);
  }, [originalCode]);

  useEffect(() => {
    if (!enabled || isFixing) return;
    setIsLoading(true);

    const timer = setTimeout(() => {
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
    }, 500);

    return () => clearTimeout(timer);
  }, [code, isFixing, enabled]);

  const handleSyntaxFix = useCallback((): void => {
    if (isFixing) return;
    setIsLoading(true);
    setIsFixing(true);

    const fixed = applyDeterministicFixes(code);
    setCode(fixed);
    setIsFixing(false);
    setIsLoading(false);
  }, [code, isFixing]);

  return {
    code,
    svgContent,
    isLoading,
    error,
    isFixing,
    handleSyntaxFix,
  };
};

import { cn } from 'cnfast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { memo, useEffect, useState } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

import { logger } from '@pi-code/shared/core/logger';
import { getHighlighter, normalizeLanguage } from '@pi-code/webview/components/chat/helpers/highlighter';
import { CopyButton } from '@pi-code/webview/components/shared/CopyButton';
import { useInViewport } from '@pi-code/webview/hooks/useInViewport';

import type { FC, ReactNode } from 'react';
import type { ShikiTransformer } from 'shiki';

const CODE_BLOCK_BG_COLOR = 'var(--vscode-editor-background, var(--vscode-sideBar-background, rgb(30, 30, 30)))';

interface CodeBlockProps {
  readonly source?: string;
  readonly language: string;
}

interface PlainCodeProps {
  readonly source: string;
  readonly language: string;
}

const PlainCode: FC<PlainCodeProps> = ({ source, language }) => (
  <pre className="p-0 m-0 bg-transparent">
    <code className={cn('hljs', `language-${language || 'txt'}`)}>{source}</code>
  </pre>
);

const useShikiHighlighter = (source: string, language: string, enabled: boolean): ReactNode => {
  const [highlightedCode, setHighlightedCode] = useState<ReactNode>(null);

  useEffect(() => {
    if (!enabled) return;

    let isMounted = true;

    const highlight = async () => {
      const highlighter = await getHighlighter(language);
      if (!isMounted) return;

      const isLightTheme = document.body.className.toLowerCase().includes('light');
      const theme = isLightTheme ? 'github-light' : 'github-dark';

      const hast = highlighter.codeToHast(source, {
        lang: language || 'txt',
        theme,
        transformers: [
          {
            pre(node) {
              node.properties.style = 'padding: 0; margin: 0; background-color: transparent;';
              return node;
            },
            code(node) {
              node.properties['class'] = `hljs language-${language}`;
              return node;
            },
          },
        ] as ShikiTransformer[],
      });

      if (!isMounted) return;
      setHighlightedCode(toJsxRuntime(hast, { Fragment, jsx, jsxs }));
    };

    highlight().catch((error) => {
      logger.error('Syntax highlighting error:', error);
      if (isMounted) setHighlightedCode(null);
    });

    return () => {
      isMounted = false;
    };
  }, [source, language, enabled]);

  return highlightedCode;
};

export const CodeBlock = memo(({ source = '', language }: CodeBlockProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const { ref: codeBlockRef, hasBeenVisible } = useInViewport<HTMLDivElement>();

  const currentLanguage = normalizeLanguage(language);
  const highlightedCode = useShikiHighlighter(source, currentLanguage, hasBeenVisible);

  if (source.length === 0) return null;

  return (
    <div
      ref={codeBlockRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative overflow-hidden border border-vscode-editorGroup-border rounded-md"
      style={{ backgroundColor: CODE_BLOCK_BG_COLOR }}
    >
      <div
        className="p-3 overflow-y-auto leading-relaxed select-text"
        style={{
          backgroundColor: 'transparent',
          maxHeight: '350px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'normal',
          overflowWrap: 'break-word',
          fontSize: 'var(--vscode-editor-font-size, var(--vscode-font-size, 12px))',
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
        }}
      >
        {highlightedCode ?? <PlainCode source={source} language={currentLanguage} />}
      </div>

      {isHovered && (
        <div className="absolute top-2 right-2 flex items-center bg-vscode-editor-background/85 backdrop-blur-sm border border-vscode-editorGroup-border rounded p-0.5 z-10 gap-0.5 select-none pointer-events-auto">
          <CopyButton text={source} size={14} />
        </div>
      )}
    </div>
  );
});

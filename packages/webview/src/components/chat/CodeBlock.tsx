import { cn } from 'cnfast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { AlignJustify, ChevronDown, ChevronUp, WrapText } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { bundledLanguages } from 'shiki';

import { logger } from '@pi-code/shared/core/logger';
import { getHighlighter, normalizeLanguage } from '@pi-code/webview/components/chat/helpers/highlighter';
import { CopyButton } from '@pi-code/webview/components/shared/CopyButton';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useInViewport } from '@pi-code/webview/hooks/useInViewport';

import type { FC, ReactNode } from 'react';
import type { ShikiTransformer } from 'shiki';
import type { ExtendedLanguage } from '@pi-code/webview/components/chat/helpers/highlighter';

const CODE_BLOCK_BG_COLOR = 'var(--vscode-editor-background, var(--vscode-sideBar-background, rgb(30, 30, 30)))';

const COLLAPSED_HEIGHT = 500;

interface CodeToolbarProps {
  readonly source: string;
  readonly currentLanguage: string;
  readonly onLanguageChange: (lang: ExtendedLanguage) => void;
  readonly showCollapseButton: boolean;
  readonly windowShade: boolean;
  readonly onToggleWindowShade: () => void;
  readonly wordWrap: boolean;
  readonly onToggleWordWrap: () => void;
}

const CodeToolbar: FC<CodeToolbarProps> = ({
  source,
  currentLanguage,
  onLanguageChange,
  showCollapseButton,
  windowShade,
  onToggleWindowShade,
  wordWrap,
  onToggleWordWrap,
}) => (
  <div className="absolute top-2 right-2 flex items-center bg-vscode-editor-background/85 backdrop-blur-sm border border-vscode-editorGroup-border rounded p-0.5 z-10 gap-0.5 select-none pointer-events-auto">
    <Tooltip content="Change syntax highlighting" side="bottom">
      <select
        value={currentLanguage}
        className="icon-button font-mono text-xs outline-none"
        style={{ width: `calc(${currentLanguage?.length || 0}ch + 20px)` }}
        onChange={(e) => onLanguageChange(normalizeLanguage(e.target.value))}
      >
        <option value={currentLanguage}>{currentLanguage}</option>
        {Object.keys(bundledLanguages)
          .sort()
          .map((lang) => {
            const normalized = normalizeLanguage(lang);
            if (normalized === currentLanguage) return null;
            return (
              <option key={lang} value={normalized} className="bg-vscode-editor-background text-vscode-foreground">
                {normalized}
              </option>
            );
          })}
      </select>
    </Tooltip>

    {showCollapseButton && (
      <Tooltip content={windowShade ? 'Expand' : 'Collapse'} side="bottom">
        <button className="icon-button" onClick={onToggleWindowShade}>
          {windowShade ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </Tooltip>
    )}

    <Tooltip content={wordWrap ? 'Disable wrap' : 'Enable wrap'} side="bottom">
      <button className="icon-button" onClick={onToggleWordWrap}>
        {wordWrap ? <AlignJustify size={14} /> : <WrapText size={14} />}
      </button>
    </Tooltip>

    <Tooltip content="Copy code" side="bottom">
      <CopyButton text={source} size={14} />
    </Tooltip>
  </div>
);

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
  const [wordWrap, setWordWrap] = useState(true);
  const [windowShade, setWindowShade] = useState(true);
  const [currentLanguage, setCurrentLanguage] = useState(() => normalizeLanguage(language));
  const [showCollapseButton, setShowCollapseButton] = useState(true);
  const [isHovered, setIsHovered] = useState(false);

  const userChangedLanguageRef = useRef(false);
  const { ref: codeBlockRef, hasBeenVisible } = useInViewport<HTMLDivElement>();

  useEffect(() => {
    const normalizedLang = normalizeLanguage(language);
    if (normalizedLang !== currentLanguage && !userChangedLanguageRef.current) {
      setCurrentLanguage(normalizedLang);
    }
  }, [language, currentLanguage]);

  const highlightedCode = useShikiHighlighter(source, currentLanguage, hasBeenVisible);

  useEffect(() => {
    if (codeBlockRef.current) {
      setShowCollapseButton(codeBlockRef.current.scrollHeight >= COLLAPSED_HEIGHT);
    }
  }, [highlightedCode]);

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
          maxHeight: windowShade ? `${COLLAPSED_HEIGHT}px` : 'none',
          whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
          wordBreak: 'normal',
          overflowWrap: wordWrap ? 'break-word' : 'normal',
          fontSize: 'var(--vscode-editor-font-size, var(--vscode-font-size, 12px))',
          fontFamily: 'var(--vscode-editor-font-family, monospace)',
        }}
      >
        {highlightedCode ?? <PlainCode source={source} language={currentLanguage} />}
      </div>

      {isHovered && (
        <CodeToolbar
          currentLanguage={currentLanguage}
          onLanguageChange={(newLang) => {
            userChangedLanguageRef.current = true;
            setCurrentLanguage(newLang);
          }}
          showCollapseButton={showCollapseButton}
          windowShade={windowShade}
          onToggleWindowShade={() => setWindowShade(!windowShade)}
          wordWrap={wordWrap}
          onToggleWordWrap={() => setWordWrap(!wordWrap)}
          source={source}
        />
      )}
    </div>
  );
});

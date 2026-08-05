import { cn } from 'cnfast';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { AlignJustify, Check, ChevronDown, ChevronUp, Copy, WrapText } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { bundledLanguages } from 'shiki';

import { useCopyToClipboard } from '@extension/webview/hooks/useCopyToClipboard';
import { getHighlighter, isLanguageLoaded, normalizeLanguage } from '@webview/components/chat/helpers/highlighter';

import type { CSSProperties, FC, MouseEvent, ReactNode } from 'react';
import type { ShikiTransformer } from 'shiki';
import type { ExtendedLanguage } from '@webview/components/chat/helpers/highlighter';

export const CODE_BLOCK_BG_COLOR = 'var(--vscode-editor-background, var(--vscode-sideBar-background, rgb(30, 30, 30)))';

interface CodeToolbarProps {
  readonly currentLanguage: string;
  readonly onLanguageChange: (lang: ExtendedLanguage) => void;
  readonly showCollapseButton: boolean;
  readonly windowShade: boolean;
  readonly onToggleWindowShade: () => void;
  readonly wordWrap: boolean;
  readonly onToggleWordWrap: () => void;
  readonly showCopy: boolean;
  readonly onCopy: (e: MouseEvent) => void;
}

export const CodeToolbar: FC<CodeToolbarProps> = ({
  currentLanguage,
  onLanguageChange,
  showCollapseButton,
  windowShade,
  onToggleWindowShade,
  wordWrap,
  onToggleWordWrap,
  showCopy,
  onCopy,
}) => (
  <div
    className="absolute top-2 right-2 flex items-center bg-[var(--vscode-editor-background)]/85 backdrop-blur-sm border border-[var(--vscode-editorGroup-border)] rounded p-0.5 z-10 gap-0.5 select-none"
    style={{ pointerEvents: 'all' }}
  >
    <select
      value={currentLanguage}
      className="text-xs text-[var(--vscode-foreground)] bg-transparent border-none cursor-pointer p-1 font-mono outline-none hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded"
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
            <option key={lang} value={normalized} className="bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)]">
              {normalized}
            </option>
          );
        })}
    </select>

    {showCollapseButton && (
      <button
        className="w-6 h-6 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
        onClick={onToggleWindowShade}
        title={windowShade ? 'Expand' : 'Collapse'}
      >
        {windowShade ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
    )}

    <button
      className="w-6 h-6 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
      onClick={onToggleWordWrap}
      title={wordWrap ? 'Disable wrap' : 'Enable wrap'}
    >
      {wordWrap ? <AlignJustify size={14} /> : <WrapText size={14} />}
    </button>

    <button
      className="w-6 h-6 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
      onClick={onCopy}
      title="Copy code"
    >
      {showCopy ? <Check size={14} /> : <Copy size={14} />}
    </button>
  </div>
);

export interface CodeBlockProps {
  readonly source?: string;
  readonly rawSource?: string;
  readonly language: string;
  readonly preStyle?: CSSProperties;
  readonly initialWordWrap?: boolean;
  readonly collapsedHeight?: number;
  readonly initialWindowShade?: boolean;
  readonly onLanguageChange?: (language: string) => void;
}

export function useShikiHighlighter(source: string, language: string): ReactNode {
  const [highlightedCode, setHighlightedCode] = useState<ReactNode>(null);

  useEffect(() => {
    let isMounted = true;

    const fallback = (
      <pre style={{ padding: 0, margin: 0, backgroundColor: 'transparent' }}>
        <code className={cn('hljs', `language-${language || 'txt'}`)}>{source}</code>
      </pre>
    );

    const highlight = async () => {
      if (language && !isLanguageLoaded(language)) {
        if (isMounted) setHighlightedCode(fallback);
      }

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
            line(node) {
              node.properties['class'] = node.properties['class'] || '';
              return node;
            },
          },
        ] as ShikiTransformer[],
      });

      if (!isMounted) return;

      try {
        const reactElement = toJsxRuntime(hast, { Fragment, jsx, jsxs });
        if (isMounted) setHighlightedCode(reactElement);
      } catch (error) {
        console.error('[CodeBlock] Error converting HAST to JSX:', error);
        if (isMounted) setHighlightedCode(fallback);
      }
    };

    highlight().catch((e) => {
      console.error('[CodeBlock] Syntax highlighting error:', e);
      if (isMounted) setHighlightedCode(fallback);
    });

    return () => {
      isMounted = false;
    };
  }, [source, language]);

  return highlightedCode;
}

export const CodeBlock = memo(
  ({
    source = '',
    rawSource,
    language,
    preStyle,
    initialWordWrap = true,
    initialWindowShade = true,
    collapsedHeight = 500,
    onLanguageChange,
  }: CodeBlockProps) => {
    const [wordWrap, setWordWrap] = useState(initialWordWrap);
    const [windowShade, setWindowShade] = useState(initialWindowShade);
    const [currentLanguage, setCurrentLanguage] = useState(() => normalizeLanguage(language));
    const [showCollapseButton, setShowCollapseButton] = useState(true);
    const [isHovered, setIsHovered] = useState(false);

    const userChangedLanguageRef = useRef(false);
    const codeBlockRef = useRef<HTMLDivElement>(null);
    const { showCopy, copy } = useCopyToClipboard();

    useEffect(() => {
      const normalizedLang = normalizeLanguage(language);
      if (normalizedLang !== currentLanguage && !userChangedLanguageRef.current) {
        setCurrentLanguage(normalizedLang);
      }
    }, [language, currentLanguage]);

    const highlightedCode = useShikiHighlighter(source, currentLanguage);

    useEffect(() => {
      if (codeBlockRef.current) {
        setShowCollapseButton(codeBlockRef.current.scrollHeight >= collapsedHeight);
      }
    }, [highlightedCode, collapsedHeight]);

    const handleCopy = useCallback(
      (e: MouseEvent) => {
        e.stopPropagation();
        const textToCopy = rawSource !== undefined ? rawSource : source;
        if (textToCopy) copy(textToCopy, e);
      },
      [source, rawSource, copy],
    );

    if (source.length === 0) return null;

    return (
      <div
        ref={codeBlockRef}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="relative overflow-hidden my-2 border border-[var(--vscode-editorGroup-border)] rounded-md"
        style={{ backgroundColor: CODE_BLOCK_BG_COLOR }}
      >
        <div
          className="p-3 overflow-y-auto leading-relaxed select-text"
          style={{
            backgroundColor: 'transparent',
            maxHeight: windowShade ? `${collapsedHeight}px` : 'none',
            whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
            wordBreak: 'normal',
            overflowWrap: wordWrap ? 'break-word' : 'normal',
            fontSize: 'var(--vscode-editor-font-size, var(--vscode-font-size, 12px))',
            fontFamily: 'var(--vscode-editor-font-family, monospace)',
            ...preStyle,
          }}
        >
          {highlightedCode}
        </div>

        {isHovered && (
          <CodeToolbar
            currentLanguage={currentLanguage}
            onLanguageChange={(newLang) => {
              userChangedLanguageRef.current = true;
              setCurrentLanguage(newLang);
              onLanguageChange?.(newLang);
            }}
            showCollapseButton={showCollapseButton}
            windowShade={windowShade}
            onToggleWindowShade={() => setWindowShade(!windowShade)}
            wordWrap={wordWrap}
            onToggleWordWrap={() => setWordWrap(!wordWrap)}
            showCopy={showCopy}
            onCopy={handleCopy}
          />
        )}
      </div>
    );
  },
);

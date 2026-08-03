import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { AlignJustify, Check, ChevronDown, ChevronUp, Copy, WrapText } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { bundledLanguages } from 'shiki';

import { useCopyToClipboard } from '@webview/components/chat/helpers/clipboard';
import { getHighlighter, isLanguageLoaded, normalizeLanguage } from '@webview/components/chat/helpers/highlighter';

import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { ShikiTransformer } from 'shiki';

export const CODE_BLOCK_BG_COLOR = 'var(--vscode-editor-background, var(--vscode-sideBar-background, rgb(30, 30, 30)))';

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

export const CodeBlock = memo(
  ({
    source,
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
    const userChangedLanguageRef = useRef(false);
    const [highlightedCode, setHighlightedCode] = useState<ReactNode>(null);
    const [showCollapseButton, setShowCollapseButton] = useState(true);
    const [isHovered, setIsHovered] = useState(false);
    const codeBlockRef = useRef<HTMLDivElement>(null);
    const preRef = useRef<HTMLDivElement>(null);
    const { showCopyFeedback, copyWithFeedback } = useCopyToClipboard();
    const isMountedRef = useRef(true);

    useEffect(() => {
      const normalizedLang = normalizeLanguage(language);
      if (normalizedLang !== currentLanguage && !userChangedLanguageRef.current) {
        setCurrentLanguage(normalizedLang);
      }
    }, [language, currentLanguage]);

    useEffect(() => {
      isMountedRef.current = true;

      const fallback = (
        <pre style={{ padding: 0, margin: 0, backgroundColor: 'transparent' }}>
          <code className={`hljs language-${currentLanguage || 'txt'}`}>{source || ''}</code>
        </pre>
      );

      const highlight = async () => {
        if (currentLanguage && !isLanguageLoaded(currentLanguage)) {
          if (isMountedRef.current) {
            setHighlightedCode(fallback);
          }
        }

        const highlighter = await getHighlighter(currentLanguage);
        if (!isMountedRef.current) return;

        const isLightTheme = document.body.className.toLowerCase().includes('light');
        const theme = isLightTheme ? 'github-light' : 'github-dark';

        const hast = highlighter.codeToHast(source || '', {
          lang: currentLanguage || 'txt',
          theme,
          transformers: [
            {
              pre(node) {
                node.properties.style = 'padding: 0; margin: 0; background-color: transparent;';
                return node;
              },
              code(node) {
                node.properties['class'] = `hljs language-${currentLanguage}`;
                return node;
              },
              line(node) {
                node.properties['class'] = node.properties['class'] || '';
                return node;
              },
            },
          ] as ShikiTransformer[],
        });
        if (!isMountedRef.current) return;

        try {
          const reactElement = toJsxRuntime(hast, {
            Fragment,
            jsx,
            jsxs,
          });

          if (isMountedRef.current) {
            setHighlightedCode(reactElement);
          }
        } catch (error) {
          console.error('[CodeBlock] Error converting HAST to JSX:', error);
          if (isMountedRef.current) {
            setHighlightedCode(fallback);
          }
        }
      };

      highlight().catch((e) => {
        console.error('[CodeBlock] Syntax highlighting error:', e);
        if (isMountedRef.current) {
          setHighlightedCode(fallback);
        }
      });

      return () => {
        isMountedRef.current = false;
      };
    }, [source, currentLanguage]);

    useEffect(() => {
      const codeBlock = codeBlockRef.current;
      if (codeBlock) {
        setShowCollapseButton(codeBlock.scrollHeight >= collapsedHeight);
      }
    }, [highlightedCode, collapsedHeight]);

    const handleCopy = useCallback(
      (e: MouseEvent) => {
        e.stopPropagation();
        const textToCopy = rawSource !== undefined ? rawSource : source || '';
        if (textToCopy) {
          copyWithFeedback(textToCopy, e);
        }
      },
      [source, rawSource, copyWithFeedback],
    );

    if (source?.length === 0) {
      return null;
    }

    return (
      <div
        ref={codeBlockRef}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="relative overflow-hidden my-2 border border-[var(--vscode-editorGroup-border)] rounded-md"
        style={{ backgroundColor: CODE_BLOCK_BG_COLOR }}
      >
        {/* Scrollable Pre Container */}
        <div
          ref={preRef}
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

        {/* Hover Menu */}
        {isHovered && (
          <div
            className="absolute top-2 right-2 flex items-center bg-[var(--vscode-editor-background)]/85 backdrop-blur-sm border border-[var(--vscode-editorGroup-border)] rounded p-0.5 z-10 gap-0.5 select-none"
            style={{ pointerEvents: 'all' }}
          >
            {/* Language Selector */}
            <select
              value={currentLanguage}
              className="text-xs text-[var(--vscode-foreground)] bg-transparent border-none cursor-pointer p-1 font-mono outline-none hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded"
              style={{
                width: `calc(${currentLanguage?.length || 0}ch + 20px)`,
              }}
              onChange={(e) => {
                const newLang = normalizeLanguage(e.target.value);
                userChangedLanguageRef.current = true;
                setCurrentLanguage(newLang);
                if (onLanguageChange) {
                  onLanguageChange(newLang);
                }
              }}
            >
              <option value={currentLanguage}>{currentLanguage}</option>
              {Object.keys(bundledLanguages)
                .sort()
                .map((lang) => {
                  const normalizedLang = normalizeLanguage(lang);
                  if (normalizedLang === currentLanguage) return null;
                  return (
                    <option key={lang} value={normalizedLang} className="bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)]">
                      {normalizedLang}
                    </option>
                  );
                })}
            </select>

            {/* Collapse / Expand Toggle */}
            {showCollapseButton && (
              <button
                className="w-6 h-6 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
                onClick={() => setWindowShade(!windowShade)}
                title={windowShade ? 'Expand' : 'Collapse'}
              >
                {windowShade ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
            )}

            {/* Word Wrap Toggle */}
            <button
              className="w-6 h-6 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
              onClick={() => setWordWrap(!wordWrap)}
              title={wordWrap ? 'Disable wrap' : 'Enable wrap'}
            >
              {wordWrap ? <AlignJustify size={14} /> : <WrapText size={14} />}
            </button>

            {/* Copy Button */}
            <button
              className="w-6 h-6 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
              onClick={handleCopy}
              title="Copy code"
            >
              {showCopyFeedback ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        )}
      </div>
    );
  },
);

import { cn } from 'cnfast';
import { memo, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';

import { extractCodeFromChildren, parseFileUri } from '@extension/webview/components/chat/markdown/helpers/markdown';
import { MermaidBlock } from '@extension/webview/components/chat/markdown/MermaidBlock';
import { useCopyToClipboard } from '@extension/webview/hooks/useCopyToClipboard';
import { CodeBlock } from '@webview/components/chat/CodeBlock';
import { vscode } from '@webview/utilities/vscode';

import type { FC, MouseEvent, ReactNode } from 'react';

interface MarkdownBlockProps {
  readonly markdown?: string;
}

const MarkdownLink: FC<{ href?: string; children?: ReactNode }> = ({ href, children, ...props }) => {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!href) return;
    const isLocalPath = href.startsWith('file://') || href.startsWith('/') || !href.includes('://');

    if (isLocalPath) {
      e.preventDefault();
      const { filePath, line } = parseFileUri(href);
      vscode?.postMessage({
        type: 'open_file',
        text: filePath,
        values: line !== undefined ? { line } : undefined,
      });
    }
  };

  return (
    <a {...props} href={href} onClick={handleClick}>
      {children}
    </a>
  );
};

const MarkdownPre: FC<{ children?: ReactNode }> = ({ children }) => {
  const { codeString, className } = extractCodeFromChildren(children);

  if (className.includes('language-mermaid')) {
    return (
      <div className="my-4">
        <MermaidBlock code={codeString} />
      </div>
    );
  }

  const match = /language-(\w+)/.exec(className);
  const language = match ? match[1] : 'text';

  return (
    <div className="my-4">
      <CodeBlock source={codeString} language={language} />
    </div>
  );
};

export const MarkdownBlock = memo(({ markdown }: MarkdownBlockProps) => {
  const components = useMemo(
    () => ({
      table: ({ children, ...props }: any) => (
        <div className="table-wrapper">
          <table {...props}>{children}</table>
        </div>
      ),
      a: MarkdownLink,
      pre: MarkdownPre,
      code: ({ children, className, ...props }: any) => (
        <code className={className} {...props}>
          {children}
        </code>
      ),
    }),
    [],
  );

  return (
    <div className="prose-markdown select-text">
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          remarkMath,
          () => (tree: any) => {
            visit(tree, 'code', (node: any) => {
              if (!node.lang) {
                node.lang = 'text';
              } else if (node.lang.includes('.')) {
                node.lang = node.lang.split('.').pop();
              }
            });
          },
        ]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {markdown || ''}
      </ReactMarkdown>
    </div>
  );
});

export interface MarkdownProps {
  readonly markdown?: string;
  readonly partial?: boolean;
}

export const Markdown = memo(({ markdown, partial }: MarkdownProps) => {
  const [isHovering, setIsHovering] = useState(false);
  const { showCopy, copy } = useCopyToClipboard(2000);

  if (!markdown || markdown.length === 0) return null;

  return (
    <div onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)} className="relative w-full">
      <div className="break-words overflow-wrap-anywhere">
        <MarkdownBlock markdown={markdown} />
      </div>
      {markdown && !partial && isHovering && (
        <div className="absolute -bottom-1 right-2 animate-fade-in rounded z-10">
          <button
            className="p-1 h-6 w-6 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-[var(--vscode-editor-background)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded transition-all duration-200"
            onClick={(e) => copy(markdown, e)}
            title="Copy as markdown"
          >
            <span className={cn('codicon', `codicon-${showCopy ? 'check' : 'copy'}`, 'text-xs')} />
          </button>
        </div>
      )}
    </div>
  );
});

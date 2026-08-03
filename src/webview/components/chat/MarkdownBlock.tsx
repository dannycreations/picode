import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';

import { CodeBlock } from '@webview/components/chat/CodeBlock';
import { MermaidBlock } from '@webview/components/chat/MermaidBlock';
import { vscode } from '@webview/utilities/vscode';

import type { MouseEvent, ReactElement } from 'react';

interface MarkdownBlockProps {
  readonly markdown?: string;
}

export const MarkdownBlock = memo(({ markdown }: MarkdownBlockProps) => {
  const components = useMemo(
    () => ({
      table: ({ children, ...props }: any) => {
        return (
          <div className="table-wrapper">
            <table {...props}>{children}</table>
          </div>
        );
      },
      a: ({ href, children, ...props }: any) => {
        const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
          const isLocalPath = href?.startsWith('file://') || href?.startsWith('/') || !href?.includes('://');

          if (!isLocalPath) {
            return;
          }

          e.preventDefault();

          let filePath = href.replace('file://', '');

          const match = filePath.match(/(.*):(\d+)(-\d+)?$/);
          let values = undefined;
          if (match) {
            filePath = match[1];
            values = { line: parseInt(match[2], 10) };
          }

          if (!filePath.startsWith('/') && !filePath.startsWith('./')) {
            filePath = './' + filePath;
          }

          vscode?.postMessage({ type: 'open_file', text: filePath, values });
        };

        return (
          <a {...props} href={href} onClick={handleClick}>
            {children}
          </a>
        );
      },
      pre: ({ children }: any) => {
        const codeEl = children as ReactElement;

        if (!codeEl || !codeEl.props) {
          return <pre>{children}</pre>;
        }

        const { className = '', children: codeChildren } = (codeEl.props as any) || {};

        let codeString = '';
        if (typeof codeChildren === 'string') {
          codeString = codeChildren;
        } else if (Array.isArray(codeChildren)) {
          codeString = codeChildren.filter((child) => typeof child === 'string').join('');
        }

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
      },
      code: ({ children, className, ...props }: any) => {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
    }),
    [],
  );

  return (
    <div className="prose-markdown select-text">
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          remarkMath,
          () => {
            return (tree: any) => {
              visit(tree, 'code', (node: any) => {
                if (!node.lang) {
                  node.lang = 'text';
                } else if (node.lang.includes('.')) {
                  node.lang = node.lang.split('.').slice(-1)[0];
                }
              });
            };
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

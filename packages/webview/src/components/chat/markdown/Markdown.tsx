import { memo, useDeferredValue, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { visit } from 'unist-util-visit';

import { CodeBlock } from '@pi-code/webview/components/chat/CodeBlock';
import { createSearchHighlightPlugin } from '@pi-code/webview/components/chat/helpers/search';
import { extractCodeFromChildren, parseFileUri } from '@pi-code/webview/components/chat/markdown/helpers/markdown';
import { MermaidBlock } from '@pi-code/webview/components/chat/markdown/MermaidBlock';
import { CopyButton } from '@pi-code/webview/components/shared/CopyButton';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { FC, MouseEvent, ReactNode } from 'react';
import type { Components } from 'react-markdown';
import type { SearchContext } from '@pi-code/webview/components/shared/Highlight';

interface MarkdownCodeNode {
  readonly type: 'code';
  lang?: string | null;
}

interface MarkdownGenericNode {
  readonly type: string;
  readonly lang?: string | null;
  readonly children?: Array<MarkdownCodeNode | MarkdownGenericNode>;
}

interface MarkdownRoot {
  readonly type: 'root';
  readonly children: Array<MarkdownCodeNode | MarkdownGenericNode>;
}

const MarkdownLink: FC<{ href?: string; children?: ReactNode }> = ({ href, children, ...props }) => {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!href) return;
    const isLocalPath = href.startsWith('file://') || href.startsWith('/') || !href.includes('://');

    if (isLocalPath) {
      e.preventDefault();
      const { filePath, line } = parseFileUri(href);
      useChatStore.getState().send({ type: 'open_file', text: filePath, values: line !== undefined ? { line } : undefined });
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

// Fenced code arrives with no language or with a filename suffix such as
// `ts.config.js`; shiki only knows the bare language.
const normalizeCodeLanguage: () => (tree: MarkdownRoot) => void = () => (tree) => {
  visit(tree, 'code', (node) => {
    if (!node.lang) {
      node.lang = 'text';
    } else if (node.lang.includes('.')) {
      node.lang = node.lang.split('.').pop() ?? 'text';
    }
  });
};

// react-markdown keys its parse on the plugin array identity, so this list is
// module-level: a fresh array per render would reparse every markdown block.
const REMARK_PLUGINS = [remarkGfm, remarkMath, normalizeCodeLanguage];

// Every value here is module scoped, so the object is built once. A fresh one
// per render would reparse every markdown block.
const MARKDOWN_COMPONENTS: Components = {
  table: ({ children, ...props }) => (
    <div className="table-wrapper">
      <table {...props}>{children}</table>
    </div>
  ),
  a: MarkdownLink,
  pre: MarkdownPre,
};

const MarkdownBlock = memo(({ markdown, search }: MarkdownProps) => {
  const searchPlugin = useMemo(() => createSearchHighlightPlugin(search), [search?.query, search?.globalOffset, search?.activeIndex]);
  const rehypePlugins = useMemo(() => [rehypeKatex, ...(searchPlugin ? [searchPlugin as typeof rehypeKatex] : [])], [searchPlugin]);

  return (
    <div className="prose-markdown select-text">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={rehypePlugins} components={MARKDOWN_COMPONENTS}>
        {markdown || ''}
      </ReactMarkdown>
    </div>
  );
});

interface MarkdownProps {
  readonly markdown?: string;
  readonly search?: SearchContext;
}

export const Markdown = memo(({ markdown, search }: MarkdownProps) => {
  const [isHovering, setIsHovering] = useState(false);

  const deferredMarkdown = useDeferredValue(markdown ?? '');

  if (!markdown) return null;

  return (
    <div onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)} className="relative w-full">
      <div className="break-words overflow-wrap-anywhere">
        <MarkdownBlock markdown={deferredMarkdown} search={search} />
      </div>
      {isHovering && (
        <div className="absolute -bottom-1 right-2 animate-fade-in rounded z-10">
          <Tooltip content="Copy as markdown" side="left">
            <CopyButton text={markdown} className="bg-vscode-editor-background transition-all duration-200" />
          </Tooltip>
        </div>
      )}
    </div>
  );
});

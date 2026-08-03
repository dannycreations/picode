import { memo, useState } from 'react';

import { useCopyToClipboard } from '@webview/components/chat/helpers/clipboard';
import { MarkdownBlock } from '@webview/components/chat/MarkdownBlock';

export interface MarkdownProps {
  readonly markdown?: string;
  readonly partial?: boolean;
}

export const Markdown = memo(({ markdown, partial }: MarkdownProps) => {
  const [isHovering, setIsHovering] = useState(false);
  const { showCopyFeedback, copyWithFeedback } = useCopyToClipboard(2000);

  if (!markdown || markdown.length === 0) {
    return null;
  }

  return (
    <div onMouseEnter={() => setIsHovering(true)} onMouseLeave={() => setIsHovering(false)} className="relative w-full">
      <div className="break-words overflow-wrap-anywhere">
        <MarkdownBlock markdown={markdown} />
      </div>
      {markdown && !partial && isHovering && (
        <div className="absolute -bottom-1 right-2 animate-fade-in rounded" style={{ zIndex: 10 }}>
          <button
            className="copy-button p-1 h-6 w-6 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-[var(--vscode-editor-background)] hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded transition-all duration-200"
            onClick={(e) => copyWithFeedback(markdown, e)}
            title="Copy as markdown"
          >
            <span className={`codicon codicon-${showCopyFeedback ? 'check' : 'copy'} text-xs`} />
          </button>
        </div>
      )}
    </div>
  );
});

import { cn } from 'cnfast';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { logger } from '@pi-code/shared/core/logger';
import { svgToPng } from '@pi-code/webview/components/chat/markdown/helpers/mermaid';
import { useMermaidRender } from '@pi-code/webview/components/chat/markdown/hooks/useMermaidRender';
import { MermaidModal } from '@pi-code/webview/components/chat/markdown/MermaidModal';
import { MermaidToolbar } from '@pi-code/webview/components/chat/markdown/MermaidToolbar';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useCopyToClipboard } from '@pi-code/webview/hooks/useCopyToClipboard';
import { useInViewport } from '@pi-code/webview/hooks/useInViewport';
import { vscode } from '@pi-code/webview/utilities/vscode';

import type { FC, MouseEvent } from 'react';

interface MermaidBlockProps {
  readonly code: string;
}

export const MermaidBlock: FC<MermaidBlockProps> = ({ code: originalCode }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalViewMode, setModalViewMode] = useState<'diagram' | 'code'>('diagram');
  const [isErrorExpanded, setIsErrorExpanded] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const { ref: rootRef, hasBeenVisible } = useInViewport<HTMLDivElement>();
  const { code, svgContent, isLoading, error, handleSyntaxFix } = useMermaidRender(originalCode, hasBeenVisible);
  const { showCopy, copy } = useCopyToClipboard();

  const handleCopy = async (e: MouseEvent) => {
    await copy(code, e);
  };

  const handleSave = async (e: MouseEvent) => {
    e.stopPropagation();
    const svgEl = containerRef.current?.querySelector('svg');
    if (!svgEl) return;

    try {
      const dataUrl = await svgToPng(svgEl);
      vscode?.postMessage({ type: 'save_image', dataUrl, filename: 'mermaid-diagram.png' });
    } catch (err) {
      logger.error('Error saving image:', err);
    }
  };

  return (
    <div ref={rootRef} className="relative my-2 select-none">
      {isLoading && <div className="py-2 text-vscode-descriptionForeground italic text-xs">Loading diagram...</div>}

      {error ? (
        <div className="mt-0 overflow-hidden mb-2 border border-vscode-editorGroup-border rounded">
          <div
            className={cn(
              'p-2 bg-vscode-editor-background flex items-center justify-between cursor-pointer',
              isErrorExpanded ? 'border-b border-vscode-editorGroup-border' : '',
            )}
            onClick={() => setIsErrorExpanded(!isErrorExpanded)}
          >
            <div className="flex items-center gap-2 flex-grow">
              <span className="codicon codicon-warning text-vscode-editorWarning-foreground text-sm shrink-0" />
              <span className="font-bold text-xs text-vscode-editor-foreground">Mermaid render error</span>
            </div>
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Tooltip content="Auto-fix common syntax issues">
                <button className="icon-button" onClick={handleSyntaxFix}>
                  <span className="codicon codicon-wand" />
                </button>
              </Tooltip>
              <Tooltip content={showCopy ? 'Copied diagram code!' : 'Copy diagram code'}>
                <button className="icon-button" onClick={handleCopy}>
                  <span className={cn('codicon', `codicon-${showCopy ? 'check' : 'copy'}`)} />
                </button>
              </Tooltip>
              <span className={cn('codicon', `codicon-chevron-${isErrorExpanded ? 'up' : 'down'}`, 'text-xs')} />
            </div>
          </div>
          {isErrorExpanded && (
            <div className="p-2 bg-vscode-editor-background text-muted flex flex-col gap-2">
              <div className="font-mono text-vscode-errorForeground break-words">{error}</div>
              <pre className="p-2 rounded bg-vscode-textCodeBlock-background text-xs overflow-x-auto font-mono text-vscode-editor-foreground">
                <code>{code}</code>
              </pre>
            </div>
          )}
        </div>
      ) : (
        <div
          className="relative w-full border border-vscode-editorGroup-border/40 rounded bg-vscode-editor-background overflow-hidden"
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          <div
            ref={containerRef}
            className={cn(
              'min-h-[20px] transition-opacity duration-200 cursor-pointer flex justify-center max-h-[300px] p-4 w-full',
              isLoading ? 'opacity-30' : 'opacity-100',
            )}
            onClick={() => setShowModal(true)}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />

          {!isLoading && isHovering && (
            <MermaidToolbar
              showCopy={showCopy}
              onOpenZoom={() => setShowModal(true)}
              onOpenSource={() => {
                setModalViewMode('code');
                setShowModal(true);
              }}
              onCopy={handleCopy}
              onSave={handleSave}
            />
          )}
        </div>
      )}

      {showModal &&
        createPortal(
          <MermaidModal
            code={code}
            svgContent={svgContent}
            modalViewMode={modalViewMode}
            showCopy={showCopy}
            setModalViewMode={setModalViewMode}
            onClose={() => setShowModal(false)}
            onCopy={handleCopy}
            onSave={handleSave}
          />,
          document.body,
        )}
    </div>
  );
};

import { cn } from 'cnfast';

import { usePanZoom } from '@webview/components/chat/markdown/hooks/usePanZoom';

import type { FC, MouseEvent } from 'react';

interface MermaidModalProps {
  readonly code: string;
  readonly svgContent: string;
  readonly modalViewMode: 'diagram' | 'code';
  readonly showCopy: boolean;
  readonly setModalViewMode: (mode: 'diagram' | 'code') => void;
  readonly onClose: () => void;
  readonly onCopy: (e: MouseEvent) => Promise<void>;
  readonly onSave: (e: MouseEvent) => Promise<void>;
}

export const MermaidModal: FC<MermaidModalProps> = ({ code, svgContent, modalViewMode, showCopy, setModalViewMode, onClose, onCopy, onSave }) => {
  const { zoomLevel, dragPosition, isDragging, adjustZoom, handleWheel, startDrag, onDrag, stopDrag } = usePanZoom();

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] p-4 select-none" onClick={onClose}>
      <div
        className="bg-[var(--vscode-editor-background)] rounded w-[90vw] h-[90vh] max-w-[1200px] flex flex-col shadow-lg border border-[var(--vscode-editorGroup-border)] relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex justify-between items-center border-b border-[var(--vscode-editorGroup-border)] bg-[var(--vscode-editor-background)] px-2">
          <div className="flex">
            <button
              className={cn(
                'px-4 py-2 border-none cursor-pointer flex items-center gap-1.5 text-xs transition-all duration-200',
                modalViewMode === 'diagram'
                  ? 'border-b-2 border-[var(--vscode-focusBorder)] text-[var(--vscode-editor-foreground)] font-semibold'
                  : 'text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-editor-foreground)]',
              )}
              onClick={() => setModalViewMode('diagram')}
            >
              <span className="codicon codicon-graph text-sm" /> Diagram
            </button>
            <button
              className={cn(
                'px-4 py-2 border-none cursor-pointer flex items-center gap-1.5 text-xs transition-all duration-200',
                modalViewMode === 'code'
                  ? 'border-b-2 border-[var(--vscode-focusBorder)] text-[var(--vscode-editor-foreground)] font-semibold'
                  : 'text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-editor-foreground)]',
              )}
              onClick={() => setModalViewMode('code')}
            >
              <span className="codicon codicon-code text-sm" /> Source Code
            </button>
          </div>
          <button
            className="w-8 h-8 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
            onClick={onClose}
            title="Close"
          >
            <span className="codicon codicon-close text-sm" />
          </button>
        </div>

        {/* Modal Content */}
        <div
          className="flex-1 p-4 pb-16 overflow-auto flex items-center justify-center relative bg-[var(--vscode-editor-background)]"
          onWheel={modalViewMode === 'diagram' ? handleWheel : undefined}
        >
          {modalViewMode === 'diagram' ? (
            <div className="w-full h-full flex items-center justify-center overflow-hidden">
              <div
                style={{
                  transform: `scale(${zoomLevel}) translate(${dragPosition.x}px, ${dragPosition.y}px)`,
                  transformOrigin: 'center center',
                  transition: isDragging ? 'none' : 'transform 0.1s ease',
                  cursor: isDragging ? 'grabbing' : 'grab',
                }}
                onMouseDown={startDrag}
                onMouseMove={onDrag}
                onMouseUp={stopDrag}
                onMouseLeave={stopDrag}
                dangerouslySetInnerHTML={{ __html: svgContent }}
                className="max-w-full max-h-full"
              />
              <div className="absolute bottom-4 left-4 bg-[var(--vscode-editor-background)] border border-[var(--vscode-editorGroup-border)] rounded px-2 py-1 text-xs text-[var(--vscode-descriptionForeground)] opacity-80">
                {Math.round(zoomLevel * 100)}%
              </div>
            </div>
          ) : (
            <textarea
              className="w-full h-full bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] border border-[var(--vscode-editorGroup-border)] rounded p-3 font-mono resize-none outline-none text-xs"
              readOnly
              value={code}
            />
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="absolute bottom-0 right-0 left-0 p-3 flex items-center justify-end gap-2 bg-[var(--vscode-editor-background)] border-t border-[var(--vscode-editorGroup-border)] rounded-b">
          {modalViewMode === 'diagram' ? (
            <>
              <button
                className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
                onClick={() => adjustZoom(-0.2)}
                title="Zoom Out"
              >
                <span className="codicon codicon-zoom-out" />
              </button>
              <button
                className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
                onClick={() => adjustZoom(0.2)}
                title="Zoom In"
              >
                <span className="codicon codicon-zoom-in" />
              </button>
              <button
                className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
                onClick={onCopy}
                title="Copy Source"
              >
                <span className={cn('codicon', `codicon-${showCopy ? 'check' : 'copy'}`)} />
              </button>
              <button
                className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
                onClick={onSave}
                title="Save PNG"
              >
                <span className="codicon codicon-save" />
              </button>
            </>
          ) : (
            <button
              className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
              onClick={onCopy}
              title="Copy Source"
            >
              <span className={cn('codicon', `codicon-${showCopy ? 'check' : 'copy'}`)} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

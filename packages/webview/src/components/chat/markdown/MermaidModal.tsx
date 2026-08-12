import { cn } from 'cnfast';

import { usePanZoom } from '@pi-code/webview/components/chat/markdown/hooks/usePanZoom';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

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
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="bg-vscode-editor-background rounded w-[90vw] h-[90vh] max-w-[1200px] flex flex-col shadow-lg border border-vscode-editorGroup-border relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex justify-between items-center border-b border-vscode-editorGroup-border bg-vscode-editor-background px-2">
          <div className="flex">
            <button
              className={cn(
                'px-4 py-2 border-none cursor-pointer flex items-center gap-1.5 text-xs transition-all duration-200',
                modalViewMode === 'diagram'
                  ? 'border-b-2 border-vscode-focusBorder text-vscode-editor-foreground font-semibold'
                  : 'text-vscode-descriptionForeground hover:text-vscode-editor-foreground',
              )}
              onClick={() => setModalViewMode('diagram')}
            >
              <span className="codicon codicon-graph text-sm" /> Diagram
            </button>
            <button
              className={cn(
                'px-4 py-2 border-none cursor-pointer flex items-center gap-1.5 text-xs transition-all duration-200',
                modalViewMode === 'code'
                  ? 'border-b-2 border-vscode-focusBorder text-vscode-editor-foreground font-semibold'
                  : 'text-vscode-descriptionForeground hover:text-vscode-editor-foreground',
              )}
              onClick={() => setModalViewMode('code')}
            >
              <span className="codicon codicon-code text-sm" /> Source Code
            </button>
          </div>
          <Tooltip content="Close" side="bottom">
            <button className="icon-button" onClick={onClose}>
              <span className="codicon codicon-close text-sm" />
            </button>
          </Tooltip>
        </div>

        {/* Modal Content */}
        <div
          className="flex-1 p-4 pb-16 overflow-auto flex items-center justify-center relative bg-vscode-editor-background"
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
              <div className="absolute bottom-4 left-4 bg-vscode-editor-background border border-vscode-editorGroup-border rounded px-2 py-1 text-muted opacity-80">
                {Math.round(zoomLevel * 100)}%
              </div>
            </div>
          ) : (
            <textarea
              className="w-full h-full bg-vscode-editor-background text-vscode-editor-foreground border border-vscode-editorGroup-border rounded p-3 font-mono resize-none outline-none text-xs"
              readOnly
              value={code}
            />
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="absolute bottom-0 right-0 left-0 p-3 flex items-center justify-end gap-2 bg-vscode-editor-background border-t border-vscode-editorGroup-border rounded-b">
          {modalViewMode === 'diagram' ? (
            <>
              <Tooltip content="Zoom out">
                <button className="icon-button" onClick={() => adjustZoom(-0.2)}>
                  <span className="codicon codicon-zoom-out" />
                </button>
              </Tooltip>
              <Tooltip content="Zoom in">
                <button className="icon-button" onClick={() => adjustZoom(0.2)}>
                  <span className="codicon codicon-zoom-in" />
                </button>
              </Tooltip>
              <Tooltip content={showCopy ? 'Copied source!' : 'Copy source'}>
                <button className="icon-button" onClick={onCopy}>
                  <span className={cn('codicon', `codicon-${showCopy ? 'check' : 'copy'}`)} />
                </button>
              </Tooltip>
              <Tooltip content="Save as PNG">
                <button className="icon-button" onClick={onSave}>
                  <span className="codicon codicon-save" />
                </button>
              </Tooltip>
            </>
          ) : (
            <Tooltip content={showCopy ? 'Copied source!' : 'Copy source'}>
              <button className="icon-button" onClick={onCopy}>
                <span className={cn('codicon', `codicon-${showCopy ? 'check' : 'copy'}`)} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
};

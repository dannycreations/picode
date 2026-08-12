import { cn } from 'cnfast';

import { usePanZoom } from '@pi-code/webview/components/chat/markdown/hooks/usePanZoom';
import { IconButton } from '@pi-code/webview/components/shared/IconButton';

import type { FC, MouseEvent } from 'react';

type ViewMode = 'diagram' | 'code';

interface MermaidModalProps {
  readonly code: string;
  readonly svgContent: string;
  readonly modalViewMode: ViewMode;
  readonly showCopy: boolean;
  readonly setModalViewMode: (mode: ViewMode) => void;
  readonly onClose: () => void;
  readonly onCopy: (e: MouseEvent) => Promise<void>;
  readonly onSave: (e: MouseEvent) => Promise<void>;
}

const ViewTab: FC<{ readonly icon: string; readonly label: string; readonly isActive: boolean; readonly onClick: () => void }> = ({
  icon,
  label,
  isActive,
  onClick,
}) => (
  <button
    className={cn(
      'px-4 py-2 border-none cursor-pointer flex items-center gap-1.5 text-xs transition-all duration-200',
      isActive
        ? 'border-b-2 border-vscode-focusBorder text-vscode-editor-foreground font-semibold'
        : 'text-vscode-descriptionForeground hover:text-vscode-editor-foreground',
    )}
    onClick={onClick}
  >
    <span className={cn('codicon', `codicon-${icon}`, 'text-sm')} /> {label}
  </button>
);

export const MermaidModal: FC<MermaidModalProps> = ({ code, svgContent, modalViewMode, showCopy, setModalViewMode, onClose, onCopy, onSave }) => {
  const { zoomLevel, dragPosition, isDragging, adjustZoom, handleWheel, startDrag, onDrag, stopDrag } = usePanZoom();
  const isDiagram = modalViewMode === 'diagram';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="bg-vscode-editor-background rounded w-[90vw] h-[90vh] max-w-[1200px] flex flex-col shadow-lg border border-vscode-editorGroup-border relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex justify-between items-center border-b border-vscode-editorGroup-border bg-vscode-editor-background px-2">
          <div className="flex">
            <ViewTab icon="graph" label="Diagram" isActive={isDiagram} onClick={() => setModalViewMode('diagram')} />
            <ViewTab icon="code" label="Source Code" isActive={!isDiagram} onClick={() => setModalViewMode('code')} />
          </div>
          <IconButton icon="close" tooltip="Close" side="bottom" className="text-sm" onClick={onClose} />
        </div>

        {/* Modal Content */}
        <div
          className="flex-1 p-4 pb-16 overflow-auto flex items-center justify-center relative bg-vscode-editor-background"
          onWheel={isDiagram ? handleWheel : undefined}
        >
          {isDiagram ? (
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

        {/* Modal Footer Controls: zoom and export only apply to the diagram. */}
        <div className="absolute bottom-0 right-0 left-0 p-3 flex items-center justify-end gap-2 bg-vscode-editor-background border-t border-vscode-editorGroup-border rounded-b">
          {isDiagram && (
            <>
              <IconButton icon="zoom-out" tooltip="Zoom out" onClick={() => adjustZoom(-0.2)} />
              <IconButton icon="zoom-in" tooltip="Zoom in" onClick={() => adjustZoom(0.2)} />
            </>
          )}
          <IconButton icon={showCopy ? 'check' : 'copy'} tooltip={showCopy ? 'Copied source!' : 'Copy source'} onClick={onCopy} />
          {isDiagram && <IconButton icon="save" tooltip="Save as PNG" onClick={onSave} />}
        </div>
      </div>
    </div>
  );
};

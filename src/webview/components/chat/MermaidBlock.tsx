import mermaid from 'mermaid-compact';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useCopyToClipboard } from '@webview/components/chat/helpers/clipboard';

import type { MouseEvent, WheelEvent } from 'react';

// Setup Mermaid theme variables for VS Code dark theme
const MERMAID_THEME = {
  background: '#1e1e1e',
  textColor: '#ffffff',
  mainBkg: '#2d2d2d',
  nodeBorder: '#888888',
  lineColor: '#cccccc',
  primaryColor: '#3c3c3c',
  primaryTextColor: '#ffffff',
  primaryBorderColor: '#888888',
  secondaryColor: '#2d2d2d',
  tertiaryColor: '#454545',
  classText: '#ffffff',
  labelColor: '#ffffff',
  actorLineColor: '#cccccc',
  actorBkg: '#2d2d2d',
  actorBorder: '#888888',
  actorTextColor: '#ffffff',
  fillType0: '#2d2d2d',
  fillType1: '#3c3c3c',
  fillType2: '#454545',
};

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose',
  theme: 'dark',
  suppressErrorRendering: true,
  themeVariables: {
    ...MERMAID_THEME,
    fontSize: '16px',
    fontFamily: "var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif)",
    noteTextColor: '#ffffff',
    noteBkgColor: '#454545',
    noteBorderColor: '#888888',
    critBorderColor: '#ff9580',
    critBkgColor: '#803d36',
    taskTextColor: '#ffffff',
    taskTextOutsideColor: '#ffffff',
    taskTextLightColor: '#ffffff',
    sectionBkgColor: '#2d2d2d',
    sectionBkgColor2: '#3c3c3c',
    altBackground: '#2d2d2d',
    linkColor: '#6cb6ff',
    compositeBackground: '#2d2d2d',
    compositeBorder: '#888888',
    titleColor: '#ffffff',
  },
});

interface MermaidBlockProps {
  readonly code: string;
}

export const MermaidBlock = ({ code: originalCode }: MermaidBlockProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isErrorExpanded, setIsErrorExpanded] = useState(false);
  const [svgContent, setSvgContent] = useState<string>('');
  const [isFixing, setIsFixing] = useState(false);
  const [code, setCode] = useState('');
  const { showCopyFeedback, copyWithFeedback } = useCopyToClipboard();

  // Modal zoom states
  const [showModal, setShowModal] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [modalViewMode, setModalViewMode] = useState<'diagram' | 'code'>('diagram');
  const [isDragging, setIsDragging] = useState(false);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setCode(originalCode);
    setIsFixing(false);
  }, [originalCode]);

  const handleSyntaxFix = () => {
    if (isFixing) return;
    setIsLoading(true);
    setIsFixing(true);

    const fixed = applyDeterministicFixes(code);
    setCode(fixed);
    setIsFixing(false);
    setIsLoading(false);
  };

  useEffect(() => {
    if (isFixing) return;
    setIsLoading(true);

    const timer = setTimeout(() => {
      mermaid
        .parse(code)
        .then(() => {
          const id = `mermaid-${Math.random().toString(36).substring(2)}`;
          return mermaid.render(id, code);
        })
        .then(({ svg }) => {
          setError(null);
          setSvgContent(svg);
        })
        .catch((err) => {
          console.warn('Mermaid parse/render failed:', err);
          const errorMessage = err instanceof Error ? err.message : 'Mermaid render error';
          setError(errorMessage);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }, 500);

    return () => clearTimeout(timer);
  }, [code, isFixing]);

  const handleCopy = async (e: MouseEvent) => {
    await copyWithFeedback(code, e);
  };

  const handleSave = async (e: MouseEvent) => {
    e.stopPropagation();
    const svgEl = containerRef.current?.querySelector('svg');
    if (!svgEl) return;

    try {
      const pngDataUrl = await svgToPng(svgEl);
      const link = document.createElement('a');
      link.download = 'mermaid-diagram.png';
      link.href = pngDataUrl;
      link.click();
    } catch (err) {
      console.error('Error saving image:', err);
    }
  };

  const adjustZoom = (amount: number) => {
    setZoomLevel((prev) => {
      const newZoom = prev + amount;
      return Math.max(0.5, Math.min(20, newZoom));
    });
  };

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -0.2 : 0.2;
    adjustZoom(delta);
  }, []);

  return (
    <div className="relative my-2 select-none">
      {isLoading && (
        <div className="py-2 text-[var(--vscode-descriptionForeground)] italic text-xs">
          {isFixing ? 'Fixing Mermaid syntax...' : 'Loading diagram...'}
        </div>
      )}

      {error ? (
        <div className="mt-0 overflow-hidden mb-2 border border-[var(--vscode-editorGroup-border)] rounded">
          <div
            className={`p-2 bg-[var(--vscode-editor-background)] flex items-center justify-between cursor-pointer ${
              isErrorExpanded ? 'border-b border-[var(--vscode-editorGroup-border)]' : ''
            }`}
            onClick={() => setIsErrorExpanded(!isErrorExpanded)}
          >
            <div className="flex items-center gap-2 flex-grow">
              <span className="codicon codicon-warning text-[var(--vscode-editorWarning-foreground)] text-sm shrink-0" />
              <span className="font-bold text-xs text-[var(--vscode-editor-foreground)]">Mermaid render error</span>
            </div>
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <button
                className="p-1 h-6 w-6 flex items-center justify-center bg-transparent border-none text-[var(--vscode-editor-foreground)] cursor-pointer hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded"
                onClick={handleSyntaxFix}
                disabled={isFixing}
                title="Auto-fix common syntax issues"
              >
                <span className={`codicon codicon-${isFixing ? 'loading animate-spin' : 'wand'}`} />
              </button>
              <button
                className="p-1 h-6 w-6 flex items-center justify-center bg-transparent border-none text-[var(--vscode-editor-foreground)] cursor-pointer hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded"
                onClick={handleCopy}
                title="Copy diagram code"
              >
                <span className={`codicon codicon-${showCopyFeedback ? 'check' : 'copy'}`} />
              </button>
              <span className={`codicon codicon-chevron-${isErrorExpanded ? 'up' : 'down'} text-xs`} />
            </div>
          </div>
          {isErrorExpanded && (
            <div className="p-2 bg-[var(--vscode-editor-background)] text-xs text-[var(--vscode-descriptionForeground)] flex flex-col gap-2">
              <div className="font-mono text-red-400 break-words">{error}</div>
              <pre className="p-2 rounded bg-[var(--vscode-textCodeBlock-background)] text-xs overflow-x-auto font-mono text-[var(--vscode-editor-foreground)]">
                <code>{code}</code>
              </pre>
            </div>
          )}
        </div>
      ) : (
        <div
          className="relative w-full border border-[var(--vscode-editorGroup-border)]/40 rounded bg-[var(--vscode-editor-background)] overflow-hidden"
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          <div
            className={`min-h-[20px] transition-opacity duration-200 cursor-pointer flex justify-center max-h-[300px] p-4 ${
              isLoading ? 'opacity-30' : 'opacity-100'
            }`}
            onClick={() => setShowModal(true)}
            dangerouslySetInnerHTML={{ __html: svgContent }}
            ref={containerRef}
            style={{ width: '100%' }}
          />

          {!isLoading && isHovering && (
            <div className="absolute bottom-2 right-2 flex gap-1 bg-[var(--vscode-editor-background)]/90 border border-[var(--vscode-editorGroup-border)] rounded p-0.5 z-10">
              <button
                className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
                onClick={() => setShowModal(true)}
                title="Zoom Diagram"
              >
                <span className="codicon codicon-zoom-in" />
              </button>
              <button
                className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
                onClick={() => {
                  setModalViewMode('code');
                  setShowModal(true);
                }}
                title="View Source"
              >
                <span className="codicon codicon-code" />
              </button>
              <button
                className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
                onClick={handleCopy}
                title="Copy Source"
              >
                <span className={`codicon codicon-${showCopyFeedback ? 'check' : 'copy'}`} />
              </button>
              <button
                className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
                onClick={handleSave}
                title="Save as PNG"
              >
                <span className="codicon codicon-save" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal View */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[1000] p-4 select-none" onClick={() => setShowModal(false)}>
          <div
            className="bg-[var(--vscode-editor-background)] rounded w-[90vw] h-[90vh] max-w-[1200px] flex flex-col shadow-lg border border-[var(--vscode-editorGroup-border)] relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-[var(--vscode-editorGroup-border)] bg-[var(--vscode-editor-background)] px-2">
              <div className="flex">
                <button
                  className={`px-4 py-2 border-none cursor-pointer flex items-center gap-1.5 text-xs transition-all duration-200 ${
                    modalViewMode === 'diagram'
                      ? 'border-b-2 border-[var(--vscode-focusBorder)] text-[var(--vscode-editor-foreground)] font-semibold'
                      : 'text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-editor-foreground)]'
                  }`}
                  onClick={() => setModalViewMode('diagram')}
                >
                  <span className="codicon codicon-graph text-sm" /> Diagram
                </button>
                <button
                  className={`px-4 py-2 border-none cursor-pointer flex items-center gap-1.5 text-xs transition-all duration-200 ${
                    modalViewMode === 'code'
                      ? 'border-b-2 border-[var(--vscode-focusBorder)] text-[var(--vscode-editor-foreground)] font-semibold'
                      : 'text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-editor-foreground)]'
                  }`}
                  onClick={() => setModalViewMode('code')}
                >
                  <span className="codicon codicon-code text-sm" /> Source Code
                </button>
              </div>
              <button
                className="w-8 h-8 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
                onClick={() => setShowModal(false)}
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
                    onMouseDown={(e) => {
                      setIsDragging(true);
                      e.preventDefault();
                    }}
                    onMouseMove={(e) => {
                      if (isDragging) {
                        setDragPosition((prev) => ({
                          x: prev.x + e.movementX / zoomLevel,
                          y: prev.y + e.movementY / zoomLevel,
                        }));
                      }
                    }}
                    onMouseUp={() => setIsDragging(false)}
                    onMouseLeave={() => setIsDragging(false)}
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
                    onClick={handleCopy}
                    title="Copy Source"
                  >
                    <span className={`codicon codicon-${showCopyFeedback ? 'check' : 'copy'}`} />
                  </button>
                  <button
                    className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
                    onClick={handleSave}
                    title="Save PNG"
                  >
                    <span className="codicon codicon-save" />
                  </button>
                </>
              ) : (
                <button
                  className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
                  onClick={handleCopy}
                  title="Copy Source"
                >
                  <span className={`codicon codicon-${showCopyFeedback ? 'check' : 'copy'}`} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Deterministic parser and syntax helper
function applyDeterministicFixes(code: string): string {
  return code
    .replace(/--&gt;/g, '-->')
    .replace(/```mermaid/g, '')
    .replace(/```/g, '')
    .trim();
}

// Convert SVG element to PNG data URL
async function svgToPng(svgEl: SVGElement): Promise<string> {
  const svgClone = svgEl.cloneNode(true) as SVGElement;
  const viewBox = svgClone.getAttribute('viewBox')?.split(' ').map(Number) || [];
  const originalWidth = viewBox[2] || svgClone.clientWidth || 800;
  const originalHeight = viewBox[3] || svgClone.clientHeight || 600;

  const editorWidth = 2400;
  const scale = editorWidth / originalWidth;
  const scaledHeight = originalHeight * scale;

  svgClone.setAttribute('width', `${editorWidth}`);
  svgClone.setAttribute('height', `${scaledHeight}`);

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgClone);
  const encodedSvg = encodeURIComponent(svgString).replace(/'/g, '%27').replace(/"/g, '%22');
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodedSvg}`;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = editorWidth;
      canvas.height = scaledHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, editorWidth, scaledHeight);
      resolve(canvas.toDataURL('image/png', 1.0));
    };
    img.onerror = () => reject(new Error('Failed to load image for PNG conversion'));
    img.src = svgDataUrl;
  });
}

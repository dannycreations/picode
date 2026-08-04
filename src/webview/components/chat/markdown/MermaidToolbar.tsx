import type { FC, MouseEvent } from 'react';

interface MermaidToolbarProps {
  readonly showCopy: boolean;
  readonly onOpenZoom: () => void;
  readonly onOpenSource: () => void;
  readonly onCopy: (e: MouseEvent) => Promise<void>;
  readonly onSave: (e: MouseEvent) => Promise<void>;
}

export const MermaidToolbar: FC<MermaidToolbarProps> = ({ showCopy, onOpenZoom, onOpenSource, onCopy, onSave }) => (
  <div className="absolute bottom-2 right-2 flex gap-1 bg-[var(--vscode-editor-background)]/90 border border-[var(--vscode-editorGroup-border)] rounded p-0.5 z-10">
    <button
      className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
      onClick={onOpenZoom}
      title="Zoom Diagram"
    >
      <span className="codicon codicon-zoom-in" />
    </button>
    <button
      className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
      onClick={onOpenSource}
      title="View Source"
    >
      <span className="codicon codicon-code" />
    </button>
    <button
      className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
      onClick={onCopy}
      title="Copy Source"
    >
      <span className={`codicon codicon-${showCopy ? 'check' : 'copy'}`} />
    </button>
    <button
      className="w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded"
      onClick={onSave}
      title="Save as PNG"
    >
      <span className="codicon codicon-save" />
    </button>
  </div>
);

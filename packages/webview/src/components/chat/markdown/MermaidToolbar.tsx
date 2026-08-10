import { cn } from 'cnfast';

import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC, MouseEvent } from 'react';

interface MermaidToolbarProps {
  readonly showCopy: boolean;
  readonly onOpenZoom: () => void;
  readonly onOpenSource: () => void;
  readonly onCopy: (e: MouseEvent) => Promise<void>;
  readonly onSave: (e: MouseEvent) => Promise<void>;
}

const TOOLBAR_BUTTON_CLASS =
  'w-7 h-7 flex items-center justify-center border-none text-[var(--vscode-editor-foreground)] bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer rounded';

export const MermaidToolbar: FC<MermaidToolbarProps> = ({ showCopy, onOpenZoom, onOpenSource, onCopy, onSave }) => (
  <div className="absolute bottom-2 right-2 flex gap-1 bg-[var(--vscode-editor-background)]/90 border border-[var(--vscode-editorGroup-border)] rounded p-0.5 z-10">
    <Tooltip content="Zoom diagram">
      <button className={TOOLBAR_BUTTON_CLASS} onClick={onOpenZoom}>
        <span className="codicon codicon-zoom-in" />
      </button>
    </Tooltip>
    <Tooltip content="View source">
      <button className={TOOLBAR_BUTTON_CLASS} onClick={onOpenSource}>
        <span className="codicon codicon-code" />
      </button>
    </Tooltip>
    <Tooltip content={showCopy ? 'Copied source!' : 'Copy source'}>
      <button className={TOOLBAR_BUTTON_CLASS} onClick={onCopy}>
        <span className={cn('codicon', `codicon-${showCopy ? 'check' : 'copy'}`)} />
      </button>
    </Tooltip>
    <Tooltip content="Save as PNG">
      <button className={TOOLBAR_BUTTON_CLASS} onClick={onSave}>
        <span className="codicon codicon-save" />
      </button>
    </Tooltip>
  </div>
);

import { IconButton } from '@pi-code/webview/components/shared/IconButton';

import type { FC, MouseEvent } from 'react';

interface MermaidToolbarProps {
  readonly showCopy: boolean;
  readonly onOpenZoom: () => void;
  readonly onOpenSource: () => void;
  readonly onCopy: (e: MouseEvent) => Promise<void>;
  readonly onSave: (e: MouseEvent) => Promise<void>;
}

export const MermaidToolbar: FC<MermaidToolbarProps> = ({ showCopy, onOpenZoom, onOpenSource, onCopy, onSave }) => (
  <div className="absolute bottom-2 right-2 flex gap-1 bg-vscode-editor-background/90 border border-vscode-editorGroup-border rounded p-0.5 z-10">
    <IconButton icon="zoom-in" tooltip="Zoom diagram" onClick={onOpenZoom} />
    <IconButton icon="code" tooltip="View source" onClick={onOpenSource} />
    <IconButton icon={showCopy ? 'check' : 'copy'} tooltip={showCopy ? 'Copied source!' : 'Copy source'} onClick={onCopy} />
    <IconButton icon="save" tooltip="Save as PNG" onClick={onSave} />
  </div>
);

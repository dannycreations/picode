import { Trash2 } from 'lucide-react';

import type { FC } from 'react';

interface HistorySelectionProps {
  readonly selectedCount: number;
  readonly isAllPageSelected: boolean;
  readonly onSelectAll: () => void;
  readonly onCancel: () => void;
  readonly onDeleteSelected: () => void;
}

export const HistorySelection: FC<HistorySelectionProps> = ({ selectedCount, isAllPageSelected, onSelectAll, onCancel, onDeleteSelected }) => (
  <div className="px-4 py-2 bg-vscode-infoBackground/20 border-b border-vscode-panel-border/30 flex items-center justify-between text-xs shrink-0">
    <div className="flex items-center gap-2">
      <button onClick={onSelectAll} className="text-button text-vscode-textLink-foreground hover:underline font-medium">
        {isAllPageSelected ? 'Deselect Page' : 'Select Page'}
      </button>
      <span className="text-vscode-descriptionForeground">|</span>
      <span className="text-vscode-foreground font-medium">{selectedCount} selected</span>
    </div>

    <div className="flex gap-1.5">
      <button
        onClick={onCancel}
        className="px-2 py-1 bg-transparent hover:bg-vscode-list-hoverBackground border border-vscode-panel-border/50 rounded cursor-pointer text-vscode-foreground font-medium text-xs"
      >
        Cancel
      </button>
      <button
        disabled={selectedCount === 0}
        onClick={onDeleteSelected}
        className="px-2 py-1 bg-vscode-errorForeground/90 hover:bg-vscode-errorForeground text-white border-none rounded cursor-pointer font-medium text-xs flex items-center gap-1 disabled:opacity-50 disabled:pointer-events-none"
      >
        <Trash2 size={10} />
        Delete Selected
      </button>
    </div>
  </div>
);

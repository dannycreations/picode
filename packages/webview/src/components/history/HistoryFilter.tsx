import { cn } from 'cnfast';
import { Check, Search, X } from 'lucide-react';

import { HISTORY_SCOPES } from '@pi-code/shared/core/constants';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC } from 'react';
import type { HistoryScope } from '@pi-code/shared/core/protocol';
import type { SortOption } from '@pi-code/webview/components/history/hooks/useHistoryFilter';

interface HistoryFilterProps {
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;
  readonly scope: HistoryScope;
  readonly onScopeChange: (scope: HistoryScope) => void;
  readonly sortBy: SortOption;
  readonly onSortChange: (sort: SortOption) => void;
  readonly isSelectionMode: boolean;
  readonly onToggleSelectionMode: () => void;
}

export const HistoryFilter: FC<HistoryFilterProps> = ({
  searchQuery,
  onSearchChange,
  scope,
  onScopeChange,
  sortBy,
  onSortChange,
  isSelectionMode,
  onToggleSelectionMode,
}) => (
  <div className="p-3 border-b border-vscode-panel-border/30 bg-vscode-editor-background/30 flex flex-col gap-2 shrink-0">
    {/* Search Input */}
    <div className="relative flex items-center w-full">
      <Search size={14} className="absolute left-2.5 text-vscode-descriptionForeground pointer-events-none" />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search task descriptions..."
        className="w-full pl-8 pr-8 py-1.5 text-xs bg-vscode-input-background text-vscode-input-foreground border border-vscode-focusBorder rounded outline-none hover:ring-1 hover:ring-vscode-focusBorder focus:ring-1 focus:ring-vscode-focusBorder"
      />
      {searchQuery && (
        <Tooltip content="Clear search" side="bottom">
          <button onClick={() => onSearchChange('')} className="icon-button absolute right-2">
            <X size={12} />
          </button>
        </Tooltip>
      )}
    </div>

    {/* Scope & Sort Controls */}
    <div className="flex items-center justify-between gap-2 mt-1">
      <div className="flex gap-1">
        {Object.values(HISTORY_SCOPES).map((s) => (
          <button
            key={s}
            onClick={() => onScopeChange(s)}
            className={cn(
              'px-2 py-1 text-xs font-medium rounded transition-colors cursor-pointer border border-vscode-panel-border/40',
              scope === s
                ? 'bg-vscode-button-background text-vscode-button-foreground'
                : 'bg-transparent text-vscode-descriptionForeground hover:text-vscode-foreground',
            )}
          >
            {s === 'current' ? 'Current Workspace' : 'All Workspaces'}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          className="px-1.5 py-0.5 text-xs bg-vscode-dropdown-background text-vscode-dropdown-foreground border border-vscode-dropdown-border rounded outline-none cursor-pointer"
        >
          <option value="newest">Sort: Newest</option>
          <option value="oldest">Sort: Oldest</option>
          <option value="alphabetical">Sort: A-Z</option>
        </select>

        <Tooltip content={isSelectionMode ? 'Exit selection mode' : 'Select tasks'} side="left">
          <button
            onClick={onToggleSelectionMode}
            className={cn(
              'p-1.5 rounded transition-colors cursor-pointer border border-vscode-panel-border/40',
              isSelectionMode
                ? 'bg-vscode-button-background text-vscode-button-foreground'
                : 'bg-transparent text-vscode-descriptionForeground hover:text-vscode-foreground',
            )}
          >
            <Check size={12} />
          </button>
        </Tooltip>
      </div>
    </div>
  </div>
);

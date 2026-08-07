import { cn } from 'cnfast';
import { Check, Search, X } from 'lucide-react';

import type { FC } from 'react';
import type { HistoryScope, SortOption } from '@webview/components/history/hooks/useHistoryFilter';

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
  <div className="p-3 border-b border-[var(--vscode-panel-border)]/30 bg-[var(--vscode-editor-background)]/30 flex flex-col gap-2 shrink-0">
    {/* Search Input */}
    <div className="relative flex items-center w-full">
      <Search size={14} className="absolute left-2.5 text-[var(--vscode-descriptionForeground)] pointer-events-none" />
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search task descriptions..."
        className="w-full pl-8 pr-8 py-1.5 text-xs bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-focusBorder)] rounded outline-none hover:ring-1 hover:ring-[var(--vscode-focusBorder)] focus:ring-1 focus:ring-[var(--vscode-focusBorder)]"
      />
      {searchQuery && (
        <button
          onClick={() => onSearchChange('')}
          className="absolute right-2 p-0.5 text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] border-none bg-transparent cursor-pointer"
        >
          <X size={12} />
        </button>
      )}
    </div>

    {/* Scope & Sort Controls */}
    <div className="flex items-center justify-between gap-2 mt-1">
      <div className="flex gap-1">
        {(['current', 'all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => onScopeChange(s)}
            className={cn(
              'px-2 py-1 text-xs font-medium rounded transition-colors cursor-pointer border border-[var(--vscode-panel-border)]/40',
              scope === s
                ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]'
                : 'bg-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]',
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
          className="px-1.5 py-0.5 text-xs bg-[var(--vscode-dropdown-background)] text-[var(--vscode-dropdown-foreground)] border border-[var(--vscode-dropdown-border)] rounded outline-none cursor-pointer"
        >
          <option value="newest">Sort: Newest</option>
          <option value="oldest">Sort: Oldest</option>
          <option value="alphabetical">Sort: A-Z</option>
        </select>

        <button
          onClick={onToggleSelectionMode}
          className={cn(
            'p-1.5 rounded transition-colors cursor-pointer border border-[var(--vscode-panel-border)]/40',
            isSelectionMode
              ? 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]'
              : 'bg-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]',
          )}
          title="Select tasks"
        >
          <Check size={12} />
        </button>
      </div>
    </div>
  </div>
);

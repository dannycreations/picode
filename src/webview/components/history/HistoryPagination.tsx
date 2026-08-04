import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { FC } from 'react';

interface HistoryPaginationProps {
  readonly currentPage: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
}

export const HistoryPagination: FC<HistoryPaginationProps> = ({ currentPage, totalPages, onPageChange }) => {
  if (totalPages <= 1) return null;

  return (
    <div className="px-4 pt-2 pb-3.5 border-t border-[var(--vscode-panel-border)]/40 bg-[var(--vscode-editor-background)]/20 flex items-center justify-between shrink-0 select-none">
      <button
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
        className="p-1 hover:bg-[var(--vscode-list-hoverBackground)] disabled:opacity-40 disabled:pointer-events-none rounded cursor-pointer text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] border-none bg-transparent transition-colors"
      >
        <ChevronLeft size={16} />
      </button>

      <span className="text-[10px] font-medium text-[var(--vscode-descriptionForeground)]">
        Page {currentPage} of {totalPages}
      </span>

      <button
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        className="p-1 hover:bg-[var(--vscode-list-hoverBackground)] disabled:opacity-40 disabled:pointer-events-none rounded cursor-pointer text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] border-none bg-transparent transition-colors"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
};

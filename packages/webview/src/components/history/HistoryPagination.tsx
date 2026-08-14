import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC } from 'react';

interface HistoryPaginationProps {
  readonly currentPage: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
}

const PAGE_BUTTON_CLASS = 'icon-button disabled:opacity-40 disabled:pointer-events-none transition-colors';

export const HistoryPagination: FC<HistoryPaginationProps> = ({ currentPage, totalPages, onPageChange }) => {
  if (totalPages <= 1) return null;

  return (
    <div className="px-4 pt-2 pb-3.5 border-t border-vscode-panel-border/40 bg-vscode-editor-background/20 flex items-center justify-between shrink-0 select-none">
      <Tooltip content="Previous page">
        <button disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)} className={PAGE_BUTTON_CLASS}>
          <ChevronLeft size={16} />
        </button>
      </Tooltip>

      <span className="text-muted">
        Page {currentPage} of {totalPages}
      </span>

      <Tooltip content="Next page">
        <button disabled={currentPage === totalPages} onClick={() => onPageChange(currentPage + 1)} className={PAGE_BUTTON_CLASS}>
          <ChevronRight size={16} />
        </button>
      </Tooltip>
    </div>
  );
};

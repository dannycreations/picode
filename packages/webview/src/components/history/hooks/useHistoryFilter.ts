import { useEffect, useMemo, useState } from 'react';

import type { Dispatch, SetStateAction } from 'react';
import type { HistoryItem } from '@pi-code/shared/core/protocol';

export type SortOption = 'newest' | 'oldest' | 'alphabetical';

export interface UseHistoryFilterReturn {
  readonly searchQuery: string;
  readonly setSearchQuery: Dispatch<SetStateAction<string>>;
  readonly sortBy: SortOption;
  readonly setSortBy: Dispatch<SetStateAction<SortOption>>;
  readonly currentPage: number;
  readonly setCurrentPage: Dispatch<SetStateAction<number>>;
  readonly totalPages: number;
  readonly filteredHistory: HistoryItem[];
  readonly paginatedItems: HistoryItem[];
}

export const useHistoryFilter = (history: HistoryItem[], itemsPerPage: number): UseHistoryFilterReturn => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [currentPage, setCurrentPage] = useState(1);

  // Filter and sort items
  const filteredHistory = useMemo(() => {
    let result = [...history];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((item) => item.task.toLowerCase().includes(q));
    }

    result.sort((a, b) => {
      if (sortBy === 'newest') return b.ts - a.ts;
      if (sortBy === 'oldest') return a.ts - b.ts;
      return a.task.localeCompare(b.task);
    });

    return result;
  }, [history, searchQuery, sortBy]);

  // Reset to the first page when the query or sort order changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortBy]);

  // Pagination bounds logic
  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / itemsPerPage));

  // After deletion shrinks the list, keep the current page within range so a
  // now-empty page does not replace a populated one.
  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredHistory.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredHistory, currentPage, itemsPerPage]);

  return {
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    currentPage,
    setCurrentPage,
    totalPages,
    filteredHistory,
    paginatedItems,
  };
};

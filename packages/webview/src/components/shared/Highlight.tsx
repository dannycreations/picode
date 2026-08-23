import { findOccurrences, splitOnOccurrences } from '@pi-code/shared/utilities/common';

import type { FC } from 'react';

export const SEARCH_HIT_CLASS = 'search-hit';
export const SEARCH_HIT_ACTIVE_CLASS = 'search-hit-active';

export interface SearchContext {
  readonly query: string;
  readonly globalOffset: number;
  readonly activeIndex: number;
}

interface OccurrenceStats {
  // How many times the query appears in one message's text.
  readonly count: number;
  // The query occurrence search currently points at, local to this text; -1 when none.
  readonly active: number;
}

function localActiveIndex(base: number, count: number, activeIndex: number): number {
  if (activeIndex < base || activeIndex >= base + count) return -1;
  return activeIndex - base;
}

// Counts matches in one message's text and translates the global active index
// into a local one, so renderers know which occurrence to emphasize.
export function locateOccurrences(text: string, search: SearchContext | undefined): OccurrenceStats {
  const count = findOccurrences(text, search?.query ?? '').length;
  return { count, active: search ? localActiveIndex(search.globalOffset, count, search.activeIndex) : -1 };
}

interface HighlightProps {
  readonly text: string;
  readonly query: string;
  readonly activeOccurrence: number;
}

const Highlight: FC<HighlightProps> = ({ text, query, activeOccurrence }) => {
  if (!query) return <>{text}</>;

  const segments = splitOnOccurrences(text, query);
  if (segments.length === 1 && segments[0].matchIndex === null) return <>{text}</>;

  return (
    <>
      {segments.map((segment) =>
        segment.matchIndex === null ? (
          segment.text
        ) : (
          <mark
            key={segment.matchIndex}
            className={segment.matchIndex === activeOccurrence ? `${SEARCH_HIT_CLASS} ${SEARCH_HIT_ACTIVE_CLASS}` : SEARCH_HIT_CLASS}
          >
            {segment.text}
          </mark>
        ),
      )}
    </>
  );
};

interface SearchableTextProps {
  readonly text: string;
  readonly search?: SearchContext;
}

export const SearchableText: FC<SearchableTextProps> = ({ text, search }) => {
  const { active } = locateOccurrences(text, search);
  return <Highlight text={text} query={search?.query ?? ''} activeOccurrence={active} />;
};

import { findOccurrences, splitOnOccurrences } from '@pi-code/shared/utilities/common';

import type { FC } from 'react';
import type { OccurrenceSegment } from '@pi-code/shared/utilities/common';

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
  readonly segments: ReadonlyArray<OccurrenceSegment>;
  readonly activeOccurrence: number;
}

const Highlight: FC<HighlightProps> = ({ text, query, segments, activeOccurrence }) => {
  if (!query) return <>{text}</>;

  const first = segments[0];
  if (segments.length === 1 && first.matchIndex === null) return <>{text}</>;

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
  const query = search?.query ?? '';
  // One scan feeds both the split and the count, so the text is not walked
  // twice for every render pass while a search is open.
  const segments = query ? splitOnOccurrences(text, query) : [{ text, matchIndex: null }];
  const count = segments.filter((segment) => segment.matchIndex !== null).length;

  return (
    <Highlight
      text={text}
      query={query}
      segments={segments}
      activeOccurrence={localActiveIndex(search?.globalOffset ?? 0, count, search?.activeIndex ?? -1)}
    />
  );
};

import { findOccurrences } from '@pi-code/shared/utilities/common';

import type { FC, ReactNode } from 'react';

export interface SearchContext {
  readonly query: string;
  readonly globalOffset: number;
  readonly activeIndex: number;
}

interface HighlightProps {
  readonly text: string;
  readonly query: string;
  readonly activeOccurrence: number;
}

export const Highlight: FC<HighlightProps> = ({ text, query, activeOccurrence }) => {
  if (!query) return <>{text}</>;

  const needle = query.toLowerCase();
  const positions = findOccurrences(text, needle);

  if (positions.length === 0) return <>{text}</>;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let local = 0;
  for (const pos of positions) {
    if (pos > cursor) nodes.push(text.slice(cursor, pos));
    const isActive = local === activeOccurrence;
    nodes.push(
      <mark key={`${pos}-${local}`} className={isActive ? 'search-hit search-hit-active' : 'search-hit'}>
        {text.slice(pos, pos + needle.length)}
      </mark>,
    );
    local++;
    cursor = pos + needle.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <>{nodes}</>;
};

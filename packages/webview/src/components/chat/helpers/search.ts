import { visit } from 'unist-util-visit';

import { findOccurrences } from '@pi-code/shared/utilities/common';
import { parseQuestionData } from '@pi-code/webview/components/chat/helpers/question';

import type { ChatMessage } from '@pi-code/shared/core/types';
import type { SearchContext } from '@pi-code/webview/components/shared/Highlight';

export function localActiveIndex(base: number, count: number, activeIndex: number): number {
  if (activeIndex < base || activeIndex >= base + count) return -1;
  return activeIndex - base;
}

export function getMessageSearchText(message: ChatMessage): string {
  switch (message.sender) {
    case 'assistant': {
      const parts: string[] = [];
      if (message.reasoning) parts.push(message.reasoning);
      if (message.text) parts.push(message.text);
      return parts.join('\n');
    }
    case 'tool': {
      // Only ask_question tool rows receive search highlighting (every other
      // tool renders through ToolMessage, which gets no search context), so
      // counting the others would send navigation to unhighlighted rows.
      if (message.toolName !== 'ask_question') return '';
      const question = parseQuestionData(message.toolArgs)?.question ?? message.text;
      const answer = message.toolStatus === 'denied' ? '' : (message.diff ?? '');
      return [question, answer].filter(Boolean).join('\n');
    }
    case 'error':
      return message.errorMessage || message.text || '';
    default:
      return message.text || '';
  }
}

export function createSearchHighlightPlugin(search: SearchContext | undefined): (() => (tree: unknown) => void) | undefined {
  if (!search?.query) return undefined;

  const query = search.query.toLowerCase();

  return () => (tree: unknown) => {
    visit(tree as Parameters<typeof visit>[0], 'text', (node, key, parent) => {
      const text = (node as { value?: string }).value;
      if (!text || key === null || key === undefined) return;
      const parentNode = parent as { children: Array<Record<string, unknown>> } | undefined;
      if (!parentNode) return;

      const positions = findOccurrences(text, query);
      if (positions.length === 0) return;

      const newNodes: Array<Record<string, unknown>> = [];
      let cursor = 0;
      let local = 0;
      for (const pos of positions) {
        if (pos > cursor) newNodes.push({ type: 'text', value: text.slice(cursor, pos) });
        const isActive = search.globalOffset + local === search.activeIndex;
        newNodes.push({
          type: 'element',
          tagName: 'mark',
          properties: { className: isActive ? ['search-hit', 'search-hit-active'] : ['search-hit'] },
          children: [{ type: 'text', value: text.slice(pos, pos + query.length) }],
        });
        local++;
        cursor = pos + query.length;
      }
      if (cursor < text.length) newNodes.push({ type: 'text', value: text.slice(cursor) });

      const position = Number(key);
      parentNode.children.splice(position, 1, ...newNodes);
      return position + newNodes.length;
    });
  };
}

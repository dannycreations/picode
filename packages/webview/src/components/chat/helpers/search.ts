import { visit } from 'unist-util-visit';

import { splitOnOccurrences } from '@pi-code/shared/utilities/common';
import { SEARCH_HIT_ACTIVE_CLASS, SEARCH_HIT_CLASS } from '@pi-code/webview/components/shared/Highlight';
import { parseQuestionData } from '@pi-code/webview/helpers/questions';

import type { ChatMessage } from '@pi-code/shared/core/types';
import type { SearchContext } from '@pi-code/webview/components/shared/Highlight';

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

  const query = search.query;

  return () => (tree: unknown) => {
    visit(tree as Parameters<typeof visit>[0], 'text', (node, key, parent) => {
      const text = (node as { value?: string }).value;
      if (!text || key === null || key === undefined) return;
      const parentNode = parent as { children: Array<Record<string, unknown>> } | undefined;
      if (!parentNode) return;

      const segments = splitOnOccurrences(text, query);
      if (segments.every((segment) => segment.matchIndex === null)) return;

      const newNodes: Array<Record<string, unknown>> = segments.map((segment) =>
        segment.matchIndex === null
          ? { type: 'text', value: segment.text }
          : {
              type: 'element',
              tagName: 'mark',
              properties: {
                className:
                  search.globalOffset + segment.matchIndex === search.activeIndex ? [SEARCH_HIT_CLASS, SEARCH_HIT_ACTIVE_CLASS] : [SEARCH_HIT_CLASS],
              },
              children: [{ type: 'text', value: segment.text }],
            },
      );

      const position = Number(key);
      parentNode.children.splice(position, 1, ...newNodes);
      return position + newNodes.length;
    });
  };
}

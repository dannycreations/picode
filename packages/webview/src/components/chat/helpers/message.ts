import { DEFAULT_CONTEXT_LIMIT } from '@pi-code/shared/core/constants';

import type { CSSProperties } from 'react';
import type { ActiveTaskState, ChatMessage, StatsData } from '@pi-code/shared/core/protocol';

export const EMPTY_STATS: StatsData = {
  tokensIn: 0,
  tokensOut: 0,
  cacheWrites: 0,
  cacheReads: 0,
  totalCost: 0,
  contextTokens: 0,
  contextLimit: DEFAULT_CONTEXT_LIMIT,
};

export function createActiveTask(id: string, title: string, messages: ChatMessage[]): ActiveTaskState {
  return { id, title, messages, ...EMPTY_STATS };
}

function hasContent(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

export function isRenderableMessage(message: ChatMessage): boolean {
  // Tool calls surfaced by dedicated UI instead of a message row.
  if (message.toolName === 'update_todo') {
    return false;
  }

  // An assistant turn is created the moment the model starts responding, so it
  // stays empty until the first text or reasoning delta arrives.
  if (message.sender === 'assistant') {
    return hasContent(message.text) || hasContent(message.reasoning);
  }

  return true;
}

export function patchMessage(messages: ChatMessage[], id: string, patch: Partial<ChatMessage>): ChatMessage[] {
  return messages.map((message) => (message.id === id ? { ...message, ...patch } : message));
}

export function patchLastAssistant(messages: ChatMessage[], patch: (message: ChatMessage) => Partial<ChatMessage>): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender !== 'assistant') continue;

    const next = [...messages];
    next[i] = { ...messages[i], ...patch(messages[i]) };
    return next;
  }
  return messages;
}

export const ROW_CONTAINMENT_STYLE: Record<ChatMessage['sender'], CSSProperties> = {
  api_request: { containIntrinsicSize: 'auto 44px' },
  checkpoint: { containIntrinsicSize: 'auto 44px' },
  info: { containIntrinsicSize: 'auto 44px' },
  error: { containIntrinsicSize: 'auto 96px' },
  user: { containIntrinsicSize: 'auto 96px' },
  queue: { containIntrinsicSize: 'auto 96px' },
  tool: { containIntrinsicSize: 'auto 120px' },
  assistant: { containIntrinsicSize: 'auto 200px' },
};

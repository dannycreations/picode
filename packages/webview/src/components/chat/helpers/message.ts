import type { ChatMessage } from '@pi-code/shared/core/types';

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

export const ESTIMATED_ROW_HEIGHT: Record<ChatMessage['sender'], number> = {
  api_request: 44,
  checkpoint: 44,
  info: 44,
  error: 96,
  user: 96,
  queue: 96,
  tool: 120,
  assistant: 200,
};

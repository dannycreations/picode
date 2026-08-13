import { FILE_TOOLS, getToolFilePath } from '@pi-code/webview/components/chat/messages/helpers/tool';

import type { ChatMessage, ReadFileSection } from '@pi-code/shared/core/types';

function hasContent(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

function canGroupFileTool(message: ChatMessage): boolean {
  return message.sender === 'tool' && message.toolName !== undefined && FILE_TOOLS.has(message.toolName) && message.toolStatus !== 'approval';
}

function collectFileSections(messages: ReadonlyArray<ChatMessage>): ReadonlyArray<ReadFileSection> {
  const sections: ReadFileSection[] = [];
  for (const message of messages) {
    if (message.files && message.files.length > 0) {
      sections.push(...message.files);
    } else {
      sections.push({ path: getToolFilePath(message.toolArgs) ?? '', content: message.diff ?? '' });
    }
  }
  return sections;
}

export function groupFileToolMessages(messages: ReadonlyArray<ChatMessage>): ChatMessage[] {
  const result: ChatMessage[] = [];
  let group: ChatMessage[] = [];

  const flushGroup = (): void => {
    if (group.length === 0) return;
    if (group.length === 1) {
      result.push(group[0]);
    } else {
      const last = group[group.length - 1];
      result.push({ ...last, id: group[0].id, files: collectFileSections(group), diff: undefined });
    }
    group = [];
  };

  for (const message of messages) {
    if (canGroupFileTool(message)) {
      if (group.length > 0 && group[0].toolName === message.toolName) {
        group.push(message);
        continue;
      }
      flushGroup();
      group = [message];
    } else {
      flushGroup();
      result.push(message);
    }
  }
  flushGroup();
  return result;
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

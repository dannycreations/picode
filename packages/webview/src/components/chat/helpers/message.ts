import type { CSSProperties } from 'react';
import type { ChatMessage } from '@pi-code/shared/core/protocol';

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

const ROW_HEIGHT_ESTIMATE_PX: Record<ChatMessage['sender'], number> = {
  api_request: 44,
  checkpoint: 44,
  info: 44,
  error: 96,
  user: 96,
  queue: 96,
  tool: 120,
  assistant: 200,
};

const rowContainmentStyles = new Map<ChatMessage['sender'], CSSProperties>();

export function getRowContainmentStyle(sender: ChatMessage['sender']): CSSProperties {
  let style = rowContainmentStyles.get(sender);
  if (style === undefined) {
    style = { containIntrinsicSize: `auto ${ROW_HEIGHT_ESTIMATE_PX[sender]}px` };
    rowContainmentStyles.set(sender, style);
  }
  return style;
}

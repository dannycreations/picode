import { buildToolSections, GROUP_TOOLS } from '@pi-code/shared/utilities/tool';

import type { AssistantChatMessage, ChatMessage, ToolChatMessage, ToolSection } from '@pi-code/shared/core/types';

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

function hasContent(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

function canGroupTool(message: ChatMessage): message is ToolChatMessage {
  if (message.sender !== 'tool' || message.toolName === undefined || !GROUP_TOOLS.has(message.toolName)) {
    return false;
  }
  // Sub-agent approvals carry a parent link and are nested under that parent
  // tool later in this function, so they stay out of the top-level group.
  // Top-level approvals join their tool group so the approve/deny UI renders
  // beneath the tool that triggered it instead of as a separate message.
  if (message.toolStatus === 'approval') {
    return message.toolCallId === undefined;
  }
  return true;
}

function collectToolSections(messages: ReadonlyArray<ChatMessage>): ToolSection[] {
  const sections: ToolSection[] = [];
  for (const message of messages) {
    if (message.sender === 'tool') {
      sections.push(...(message.toolSections ?? buildToolSections(message)));
    }
  }
  return sections;
}

export function rebuildToolSections(messages: ChatMessage[], id: string): ChatMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.id !== id || message.sender !== 'tool') return message;
    changed = true;
    return { ...message, toolSections: buildToolSections(message) };
  });
  return changed ? next : messages;
}

export function groupToolMessages(messages: ReadonlyArray<ChatMessage>): ChatMessage[] {
  const result: ChatMessage[] = [];
  let group: ToolChatMessage[] = [];

  const flushGroup = (): void => {
    if (group.length === 0) return;
    const sections = collectToolSections(group);
    const last = group[group.length - 1];
    result.push(group.length === 1 ? { ...group[0], toolSections: sections } : { ...last, id: group[0].id, toolSections: sections });
    group = [];
  };

  for (const message of messages) {
    if (canGroupTool(message)) {
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

  const approvalIdsToRemove = new Set<string>();

  for (const m of result) {
    if (m.sender !== 'tool' || m.toolCallId === undefined) continue;
    const parentId = m.toolCallId;
    const parentMsg = result.find((p) => p.sender === 'tool' && p.toolSections?.some((section) => section.id === parentId));

    if (parentMsg && parentMsg.sender === 'tool' && parentMsg.toolSections) {
      if (m.toolStatus === 'approval') {
        const updatedMsg = {
          ...parentMsg,
          toolSections: parentMsg.toolSections.map((section) => {
            if (section.id === parentId) {
              return {
                ...section,
                status: 'approval',
                approvalMessage: m,
              };
            }
            return section;
          }),
        };
        const index = result.findIndex((r) => r.id === parentMsg.id);
        if (index !== -1) {
          result[index] = updatedMsg;
        }
      }
      approvalIdsToRemove.add(m.id);
    }
  }

  if (approvalIdsToRemove.size > 0) {
    return result.filter((m) => !approvalIdsToRemove.has(m.id));
  }

  return result;
}

export function isRenderableMessage(message: ChatMessage): boolean {
  // Tool calls surfaced by dedicated UI instead of a message row.
  if (message.sender === 'tool' && message.toolName === 'update_todo') {
    return false;
  }

  // An assistant turn is created the moment the model starts responding, so it
  // stays empty until the first text or reasoning delta arrives.
  if (message.sender === 'assistant') {
    return hasContent(message.text) || hasContent(message.reasoning);
  }

  return true;
}

export function hasPendingApproval(messages: ReadonlyArray<ChatMessage>): boolean {
  return messages.some(
    (message) =>
      (message.sender === 'tool' || message.sender === 'assistant' || message.sender === 'api_request') && message.toolStatus === 'approval',
  );
}

// Sub-agent events can arrive before the webview has rendered the parent tool
// row. Callers use this to skip such updates instead of creating orphan rows.
export function ignoreUnknownSubagent(messages: ReadonlyArray<ChatMessage>, subagent: string | undefined, id: string): boolean {
  return subagent !== undefined && !messages.some((message) => message.id === id);
}

interface RequestSettlePatch {
  readonly cost?: number;
  readonly error?: string;
}

export function settlePendingTurns(messages: ChatMessage[], patch: RequestSettlePatch = {}): ChatMessage[] {
  let changed = false;
  const next = messages.map((m) => {
    if (m.sender !== 'api_request' && m.sender !== 'assistant' && m.sender !== 'tool') return m;
    if (m.toolStatus !== 'running') return m;
    if (m.sender === 'api_request') {
      changed = true;
      return {
        ...m,
        toolStatus: patch.error ? ('denied' as const) : ('completed' as const),
        cost: patch.cost ?? m.cost,
        errorMessage: patch.error ?? m.errorMessage,
      };
    }
    if (m.sender === 'assistant') {
      changed = true;
      return {
        ...m,
        toolStatus: 'completed' as const,
      };
    }
    return m;
  });
  return changed ? next : messages;
}

export function patchMessage(messages: ChatMessage[], id: string, patch: Partial<ChatMessage>): ChatMessage[] {
  return messages.map((message) => (message.id === id ? { ...message, ...patch } : message));
}

export function resolveApproval(messages: ChatMessage[], msgId: string, approved: boolean): ChatMessage[] {
  if (!approved) {
    return patchMessage(messages, msgId, { toolStatus: 'denied', pausedAt: undefined });
  }

  const target = messages.find((message) => message.id === msgId);
  const ts = target?.sender === 'tool' && target.pausedAt !== undefined ? target.ts + (Date.now() - target.pausedAt) : Date.now();
  return patchMessage(messages, msgId, { toolStatus: 'running', ts, pausedAt: undefined });
}

export function patchLastAssistant(messages: ChatMessage[], patch: (message: AssistantChatMessage) => Partial<AssistantChatMessage>): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.sender !== 'assistant') continue;

    const next = [...messages];
    next[i] = { ...message, ...patch(message) };
    return next;
  }
  return messages;
}

export function upsertToolMessage(messages: ChatMessage[], id: string, patch: Partial<ToolChatMessage>): ChatMessage[] {
  if (messages.some((m) => m.id === id)) {
    return patchMessage(messages, id, patch);
  }

  const toolMessage: ChatMessage = { id, sender: 'tool', text: '', ts: Date.now(), ...patch };

  const queueIndex = messages.findIndex((message) => message.sender === 'queue');
  if (queueIndex === -1) return [...messages, toolMessage];

  return [...messages.slice(0, queueIndex), toolMessage, ...messages.slice(queueIndex)];
}

export function deliverQueuedReplies(messages: ChatMessage[], delivered: ChatMessage[]): ChatMessage[] {
  if (delivered.length === 0) return messages;

  // A delivered reply reuses the id of the queued message it replaces, so the
  // queued variant must be swapped for the user variant instead of skipped as
  // a duplicate. Messages without a queued twin are appended.
  const deliveredById = new Map(delivered.map((message) => [message.id, message]));
  const replaced = messages.map((message) => deliveredById.get(message.id) ?? message);
  const appended = delivered.filter((deliveredMessage) => !messages.some((message) => message.id === deliveredMessage.id));

  return [...replaced, ...appended];
}

function noticeKey(message: ChatMessage): string {
  const errorNotice = message.sender === 'tool' || message.sender === 'api_request' || message.sender === 'error' ? message.errorMessage : undefined;
  return errorNotice ?? message.text;
}

export function appendOnce(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (messages.some((m) => m.id === message.id)) return messages;

  // Consecutive identical notices are collapsed into the first one.
  const last = messages[messages.length - 1];
  if (last?.sender === message.sender && noticeKey(last) === noticeKey(message)) {
    return messages;
  }

  return [...messages, message];
}

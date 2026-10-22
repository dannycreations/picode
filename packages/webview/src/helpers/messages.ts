import { findReplaceableFailedRequest, hasVisibleText, setBounded } from '@pi-code/shared/utilities/common';
import { buildToolSections, GROUP_TOOLS } from '@pi-code/shared/utilities/tool';

import type { ApiRequestChatMessage, AssistantChatMessage, ChatMessage, ToolChatMessage, ToolSection } from '@pi-code/shared/core/types';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

const COMMAND_OUTPUT_PREVIEW_LIMIT = 100_000;

export function insertIndexAboveQueue(messages: readonly ChatMessage[]): number {
  const index = messages.findIndex((message) => message.sender === 'queue');
  return index === -1 ? messages.length : index;
}

export function insertRow(messages: readonly ChatMessage[], row: ChatMessage): ChatMessage[] {
  const next = messages.slice();
  next.splice(insertIndexAboveQueue(messages), 0, row);
  return next;
}

export function appendCommandOutput(current: string | undefined, chunk: string): string {
  const combined = (current ?? '') + chunk;
  return combined.length > COMMAND_OUTPUT_PREVIEW_LIMIT ? combined.slice(-COMMAND_OUTPUT_PREVIEW_LIMIT) : combined;
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
    if (message.sender !== 'tool') continue;
    const messageSections = message.toolSections ?? buildToolSections(message);
    for (const section of messageSections) sections.push(section);
  }
  return sections;
}

interface GroupedRow {
  readonly members: readonly ChatMessage[];
  readonly row: ChatMessage;
}

const GROUPED_ROW_CACHE_LIMIT = 512;
const groupedRowCache = new Map<string, GroupedRow>();

function sameMembers(cached: readonly ChatMessage[], group: readonly ToolChatMessage[]): boolean {
  if (cached.length !== group.length) return false;
  for (let index = 0; index < group.length; index++) {
    if (cached[index] !== group[index]) return false;
  }
  return true;
}

export function groupToolMessages(messages: ReadonlyArray<ChatMessage>): ChatMessage[] {
  const result: ChatMessage[] = [];
  let group: ToolChatMessage[] = [];
  // Only a row that names the tool call it belongs to has to be nested under
  // that row, so the lookup table for the nesting is built only when one
  // exists.
  let hasParentLink = false;

  const flushGroup = (): void => {
    if (group.length === 0) return;
    const first = group[0];
    let row: ChatMessage;
    if (group.length === 1 && first.toolSections !== undefined) {
      // A lone row that already carries its sections is pushed as is. Rebuilding
      // it would hand every mounted tool row a fresh object on each streamed
      // token, so the chat body's memo would never hit for any of them.
      row = first;
    } else {
      const cached = groupedRowCache.get(first.id);
      if (cached && sameMembers(cached.members, group)) {
        row = cached.row;
      } else {
        row = { ...group[group.length - 1], id: first.id, toolSections: collectToolSections(group) };
        // The cache drops one entry instead of wiping itself, so a long
        // session never loses every grouped row at once and re-renders all of
        // its mounted tool rows in one frame.
        setBounded(groupedRowCache, first.id, { members: group, row }, GROUPED_ROW_CACHE_LIMIT);
      }
    }
    result.push(row);
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
    if (message.sender === 'tool' && message.toolCallId !== undefined) hasParentLink = true;
  }

  flushGroup();

  if (!hasParentLink) return result;

  const parentIndexByToolCallId = new Map<string, number>();
  for (let index = 0; index < result.length; index++) {
    const row = result[index];
    if (row.sender !== 'tool' || row.toolSections === undefined) continue;
    for (const section of row.toolSections) {
      if (section.id !== undefined && !parentIndexByToolCallId.has(section.id)) {
        parentIndexByToolCallId.set(section.id, index);
      }
    }
  }

  const approvalIdsToRemove = new Set<string>();

  for (const m of result) {
    if (m.sender !== 'tool' || m.toolCallId === undefined) continue;

    const parentIndex = parentIndexByToolCallId.get(m.toolCallId);
    if (parentIndex === undefined) continue;

    // The map only ever holds the index of a tool row that carries sections.
    const parentMsg = result[parentIndex] as ToolChatMessage & { readonly toolSections: readonly ToolSection[] };

    if (m.toolStatus === 'approval') {
      result[parentIndex] = {
        ...parentMsg,
        toolSections: parentMsg.toolSections.map((section) =>
          section.id === m.toolCallId ? { ...section, status: 'approval', approvalMessage: m } : section,
        ),
      };
    }
    approvalIdsToRemove.add(m.id);
  }

  if (approvalIdsToRemove.size > 0) {
    return result.filter((m) => !approvalIdsToRemove.has(m.id));
  }

  return result;
}

interface MessageVisibility {
  readonly renderable: boolean;
  readonly hasText: boolean;
  readonly hasReasoning: boolean;
}

const STATIC_VISIBILITY: MessageVisibility = { renderable: true, hasText: true, hasReasoning: false };

export function messageVisibility(message: ChatMessage): MessageVisibility {
  if (message.sender !== 'assistant') return STATIC_VISIBILITY;

  const hasText = hasVisibleText(message.text);
  const hasReasoning = hasVisibleText(message.reasoning);
  return { renderable: hasText || hasReasoning, hasText, hasReasoning };
}

function todoListOf(message: ChatMessage): TodoItem[] | undefined {
  return message.sender === 'tool' && message.toolName === 'update_todo' ? message.todos : undefined;
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

export function settlePendingTurns(messages: ChatMessage[], patch: RequestSettlePatch = {}, onlyId?: string): ChatMessage[] {
  let next: ChatMessage[] | null = null;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.sender !== 'api_request' && message.sender !== 'assistant') continue;
    if (onlyId !== undefined) {
      // A named row is settling from its own terminal event, which owns
      // the final cost and error even when a mid-turn event closed the
      // row early. Blanket settles keep the running guard so they never
      // overwrite a row an earlier event already settled.
      if (message.id !== onlyId) continue;
    } else if (message.toolStatus !== 'running') {
      continue;
    }
    if (next === null) next = messages.slice();
    next[index] =
      message.sender === 'api_request'
        ? {
            ...message,
            toolStatus: patch.error ? ('denied' as const) : ('completed' as const),
            cost: patch.cost ?? message.cost,
            errorMessage: patch.error ?? message.errorMessage,
          }
        : { ...message, toolStatus: 'completed' as const };
  }
  return next ?? messages;
}

export function patchMessage(messages: ChatMessage[], id: string, patch: Partial<ChatMessage>): ChatMessage[] {
  let next: ChatMessage[] | null = null;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.id !== id) continue;
    if (next === null) next = messages.slice();
    next[index] = { ...message, ...patch };
  }
  return next ?? messages;
}

export function patchRetryDeadline(messages: ChatMessage[], retryAt: number | undefined): ChatMessage[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.sender !== 'api_request') continue;
    if (message.retryAt === retryAt) return messages;
    return patchMessage(messages, message.id, { retryAt });
  }
  return messages;
}

export function startApiRequest(messages: ChatMessage[], id: string, timestamp: number): ChatMessage[] {
  // A request that is already on screen needs no second row.
  if (messages.some((message) => message.id === id)) return messages;

  // The row that still shows a retry deadline is the last request row.
  let deadlineIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].sender === 'api_request') {
      deadlineIndex = index;
      break;
    }
  }

  // The failed request a retry replaces is the run of denied requests at the
  // end of the transcript.
  const retryIndex = findReplaceableFailedRequest(messages);

  // The request row lands ahead of the queued replies, which wait at the
  // bottom of the transcript.
  const queueIndex = insertIndexAboveQueue(messages);

  // A retry drops the failed run it replaces. The replies waiting below it are
  // still queued, so they stay.
  const limit = retryIndex !== undefined ? Math.min(retryIndex, queueIndex) : queueIndex;
  const next: ChatMessage[] = [];
  for (let index = 0; index < limit; index++) {
    const message = messages[index];

    let updated: ChatMessage = message;
    if (message.sender === 'api_request') {
      let request: ApiRequestChatMessage = message;
      if (request.toolStatus === 'running') request = { ...request, toolStatus: 'completed' };
      // A request in flight ends any retry wait still on screen. The retried
      // turn usually replaces the failed row and drops the deadline with it, but
      // a turn that streamed text first keeps that row, so the deadline has to
      // go explicitly.
      if (index === deadlineIndex && request.retryAt !== undefined) {
        request = { ...request, retryAt: undefined };
      }
      updated = request;
    } else if (message.sender === 'assistant') {
      if (message.toolStatus === 'running') updated = { ...message, toolStatus: 'completed' };
    }
    next.push(updated);
  }

  next.push({ id, sender: 'api_request', text: 'API Request', timestamp, toolStatus: 'running' });

  // The queued replies keep their place at the bottom of the transcript.
  for (let index = Math.max(limit, queueIndex); index < messages.length; index++) {
    next.push(messages[index]);
  }
  return next;
}

export function resolveApproval(messages: ChatMessage[], msgId: string, approved: boolean): ChatMessage[] {
  if (!approved) {
    return patchMessage(messages, msgId, { toolStatus: 'denied', pausedAt: undefined });
  }

  const target = messages.find((message) => message.id === msgId);
  const timestamp = target?.sender === 'tool' && target.pausedAt !== undefined ? target.timestamp + (Date.now() - target.pausedAt) : Date.now();
  return patchMessage(messages, msgId, { toolStatus: 'running', timestamp, pausedAt: undefined });
}

export function patchLastAssistant(messages: ChatMessage[], patch: (message: AssistantChatMessage) => Partial<AssistantChatMessage>): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.sender !== 'assistant') continue;

    const next = { ...message, ...patch(message) } as AssistantChatMessage;
    const copy = messages.slice();
    copy[i] = next;
    return copy;
  }
  return messages;
}

export function appendAssistantDelta(messages: ChatMessage[], text: string | undefined, thinking: string | undefined): ChatMessage[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.sender !== 'assistant') continue;

    const next: AssistantChatMessage = {
      ...message,
      text: text ? message.text + text : message.text,
      reasoning: thinking ? (message.reasoning ?? '') + thinking : message.reasoning,
    };

    const copy = messages.slice();
    copy[index] = next;
    return copy;
  }
  return messages;
}

export function upsertToolRow(messages: ChatMessage[], id: string, patch: Partial<ToolChatMessage>): ChatMessage[] {
  const existingIndex = messages.findIndex((message) => message.id === id);
  // A new tool row lands ahead of the queued replies, so the reply the user
  // typed while the tool ran still shows below it.
  const queueIndex = insertIndexAboveQueue(messages);

  const createRow = (): ChatMessage => {
    const row: ToolChatMessage = { id, sender: 'tool', text: '', timestamp: Date.now(), ...patch };
    return { ...row, toolSections: buildToolSections(row) };
  };

  const next = messages.slice();
  const inserted = existingIndex === -1;
  if (inserted) {
    next.splice(queueIndex, 0, createRow());
  }

  // The inserted row pushed the rows from its place onwards one place along.
  const shifted = inserted && queueIndex < messages.length;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];

    let updated = message;
    if (message.sender === 'api_request' || message.sender === 'assistant') {
      if (message.toolStatus === 'running') updated = { ...message, toolStatus: 'completed' as const };
    }
    if (index === existingIndex) {
      const patched = { ...updated, ...patch } as ToolChatMessage;
      updated = { ...patched, toolSections: buildToolSections(patched) };
    }
    next[shifted && index >= queueIndex ? index + 1 : index] = updated;
  }

  return next;
}

export function patchToolRow(
  messages: ChatMessage[],
  id: string,
  subagent: string | undefined,
  patch: (target: ToolChatMessage) => Partial<ToolChatMessage>,
): ChatMessage[] {
  let next: ChatMessage[] | null = null;
  let found = false;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.id !== id) continue;
    found = true;
    if (message.sender !== 'tool') continue;
    const patched = { ...message, ...patch(message) };
    if (next === null) next = messages.slice();
    next[index] = { ...patched, toolSections: buildToolSections(patched) };
  }

  // A sub-agent event for a row the webview never showed has nothing to
  // update, and creating one would leave an orphan row behind.
  if (!found && subagent !== undefined) return messages;
  return next ?? messages;
}

export function deliverQueuedReplies(messages: ChatMessage[], delivered: ChatMessage[]): ChatMessage[] {
  if (delivered.length === 0) return messages;

  // A delivered reply reuses the id of the queued message it replaces, so the
  // queued variant must be swapped for the user variant instead of skipped as
  // a duplicate. Messages without a queued twin are appended.
  const deliveredById = new Map<string, ChatMessage>();
  for (const message of delivered) deliveredById.set(message.id, message);

  const seen = new Set<string>();
  const result: ChatMessage[] = [];
  for (const message of messages) {
    seen.add(message.id);
    result.push(deliveredById.get(message.id) ?? message);
  }

  for (const message of delivered) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    result.push(message);
  }

  return result;
}

export function patchReplyQueue(messages: ChatMessage[], queue: readonly ChatMessage[]): ChatMessage[] {
  const queueById = new Map<string, ChatMessage>();
  for (const message of queue) queueById.set(message.id, message);

  const seen = new Set<string>();
  const result: ChatMessage[] = [];
  for (const message of messages) {
    // Update existing queued replies in place so their position stays fixed
    // even if non-queue messages were added after them in the transcript.
    const queued = message.sender === 'queue' ? queueById.get(message.id) : undefined;
    // Drop queue entries that disappeared from the backend queue.
    if (message.sender === 'queue' && !queued) continue;

    seen.add(message.id);
    result.push(queued ? { ...message, ...queued } : message);
  }

  // Append only genuinely new queue messages at the end.
  for (const message of queue) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    result.push(message);
  }

  return result;
}

function noticeKey(message: ChatMessage): string {
  const errorNotice = message.sender === 'tool' || message.sender === 'api_request' || message.sender === 'error' ? message.errorMessage : undefined;
  return errorNotice ?? message.text;
}

export function appendOnce(messages: ChatMessage[], message: ChatMessage, index: number = messages.length): ChatMessage[] {
  for (let position = 0; position < messages.length; position++) {
    if (messages[position].id === message.id) return messages;
  }

  // Consecutive identical notices are collapsed into the first one.
  const previous = messages[index - 1];
  if (previous?.sender === message.sender && noticeKey(previous) === noticeKey(message)) {
    return messages;
  }

  const next = messages.slice();
  next.splice(index, 0, message);
  return next;
}

interface ChatRenderModel {
  readonly renderItems: ChatMessage[];
  readonly oldTodosById: ReadonlyMap<string, TodoItem[]>;
  readonly hasApproval: boolean;
  readonly latestTodos: TodoItem[] | undefined;
}

export function buildChatRenderModel(messages: ReadonlyArray<ChatMessage>): ChatRenderModel {
  const visible: ChatMessage[] = [];
  const oldTodosById = new Map<string, TodoItem[]>();
  let previousTodos: TodoItem[] | undefined;
  let latestTodos: TodoItem[] | undefined;
  let hasApproval = false;

  for (const message of messages) {
    // The approval state and the checklist belong to the whole transcript, not
    // to the rows that happen to be on screen.
    if (message.sender === 'tool' || message.sender === 'assistant' || message.sender === 'api_request') {
      if (message.toolStatus === 'approval') hasApproval = true;
    }

    // Every update_todo row needs the checklist that was in effect before it,
    // so the chat body can show only what that step changed.
    const todos = todoListOf(message);
    if (todos) {
      if (previousTodos) oldTodosById.set(message.id, previousTodos);
      previousTodos = todos;
      latestTodos = todos;
    }

    if (!messageVisibility(message).renderable) continue;
    visible.push(message);
  }

  return { renderItems: groupToolMessages(visible), oldTodosById, hasApproval, latestTodos };
}

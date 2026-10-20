import { hasVisibleOutput } from '@pi-code/shared/utilities/common';
import { buildToolSections, GROUP_TOOLS } from '@pi-code/shared/utilities/tool';

import type { AssistantChatMessage, ChatMessage, ToolChatMessage, ToolSection } from '@pi-code/shared/core/types';
import type { TodoItem } from '@pi-code/shared/utilities/todo';

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

export function rebuildToolSections(messages: ChatMessage[], id: string): ChatMessage[] {
  let next: ChatMessage[] | null = null;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.id !== id || message.sender !== 'tool') continue;
    if (next === null) next = messages.slice();
    next[index] = { ...message, toolSections: buildToolSections(message) };
  }
  return next ?? messages;
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
        if (groupedRowCache.size >= GROUPED_ROW_CACHE_LIMIT) groupedRowCache.clear();
        groupedRowCache.set(first.id, { members: group.slice(), row });
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

    const parentMsg = result[parentIndex];
    if (parentMsg.sender !== 'tool') continue;

    if (m.toolStatus === 'approval' && parentMsg.toolSections) {
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

const renderableCache = new WeakMap<ChatMessage, boolean>();

export function isRenderableMessage(message: ChatMessage): boolean {
  if (message.sender !== 'assistant') return true;
  const cached = renderableCache.get(message);
  if (cached !== undefined) return cached;
  const renderable = hasVisibleOutput(message);
  renderableCache.set(message, renderable);
  return renderable;
}

export function hasPendingApproval(messages: ReadonlyArray<ChatMessage>): boolean {
  for (const message of messages) {
    if (message.sender !== 'tool' && message.sender !== 'assistant' && message.sender !== 'api_request') continue;
    if (message.toolStatus === 'approval') return true;
  }
  return false;
}

function todoListOf(message: ChatMessage): TodoItem[] | undefined {
  return message.sender === 'tool' && message.toolName === 'update_todo' ? message.todos : undefined;
}

// The newest update_todo row holds the checklist the task header should show.
export function latestTodos(messages: ReadonlyArray<ChatMessage>): TodoItem[] | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const todos = todoListOf(messages[i]);
    if (todos) return todos;
  }
  return undefined;
}

// Every update_todo row needs the checklist that was in effect before it, so
// the chat body can show only what that step changed. One forward pass answers
// all of them; resolving each row on its own rescans the transcript per row.
export function previousTodosById(messages: ReadonlyArray<ChatMessage>): ReadonlyMap<string, TodoItem[]> {
  const previousById = new Map<string, TodoItem[]>();
  let previous: TodoItem[] | undefined;

  for (const message of messages) {
    const todos = todoListOf(message);
    if (!todos) continue;
    if (previous) previousById.set(message.id, previous);
    previous = todos;
  }

  return previousById;
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

    const next = messages.slice();
    next[i] = { ...message, ...patch(message) };
    return next;
  }
  return messages;
}

export function upsertToolMessage(messages: ChatMessage[], id: string, patch: Partial<ToolChatMessage>): ChatMessage[] {
  let existingIndex = -1;
  let queueIndex = -1;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (existingIndex === -1 && message.id === id) existingIndex = index;
    if (queueIndex === -1 && message.sender === 'queue') queueIndex = index;
  }

  if (existingIndex !== -1) {
    const next = messages.slice();
    next[existingIndex] = { ...messages[existingIndex], ...patch };
    return next;
  }

  const toolMessage: ChatMessage = { id, sender: 'tool', text: '', timestamp: Date.now(), ...patch };
  const next = messages.slice();
  next.splice(queueIndex === -1 ? messages.length : queueIndex, 0, toolMessage);
  return next;
}

export function upsertToolRow(messages: ChatMessage[], id: string, patch: Partial<ToolChatMessage>): ChatMessage[] {
  let existingIndex = -1;
  let queueIndex = -1;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (existingIndex === -1 && message.id === id) existingIndex = index;
    if (queueIndex === -1 && message.sender === 'queue') queueIndex = index;
  }

  const createRow = (): ChatMessage => {
    const row: ToolChatMessage = { id, sender: 'tool', text: '', timestamp: Date.now(), ...patch };
    return { ...row, toolSections: buildToolSections(row) };
  };

  const result: ChatMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];

    // A new tool row lands ahead of the queued replies, so the reply the user
    // typed while the tool ran still shows below it.
    if (existingIndex === -1 && index === queueIndex) result.push(createRow());

    let updated = message;
    if (message.sender === 'api_request' || message.sender === 'assistant') {
      if (message.toolStatus === 'running') updated = { ...message, toolStatus: 'completed' as const };
    }
    if (index === existingIndex) {
      const patched = { ...updated, ...patch } as ToolChatMessage;
      updated = { ...patched, toolSections: buildToolSections(patched) };
    }
    result.push(updated);
  }
  if (existingIndex === -1 && queueIndex === -1) result.push(createRow());

  return result;
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
  const deliveredById = new Map(delivered.map((message) => [message.id, message]));
  const replaced = messages.map((message) => deliveredById.get(message.id) ?? message);
  const existingIds = new Set(messages.map((message) => message.id));
  const appended = delivered.filter((deliveredMessage) => !existingIds.has(deliveredMessage.id));

  return [...replaced, ...appended];
}

export function patchReplyQueue(messages: ChatMessage[], queue: readonly ChatMessage[]): ChatMessage[] {
  const queueById = new Map(queue.map((m) => [m.id, m]));

  // Update existing queued replies in place so their position stays fixed
  // even if non-queue messages were added after them in the transcript.
  const updated = messages.map((m) => {
    if (m.sender === 'queue' && queueById.has(m.id)) {
      return { ...m, ...queueById.get(m.id)! };
    }
    return m;
  });

  // Drop queue entries that disappeared from the backend queue.
  const filtered = updated.filter((m) => m.sender !== 'queue' || queueById.has(m.id));

  // Append only genuinely new queue messages at the end.
  const existingIds = new Set(filtered.map((m) => m.id));
  const newQueueMessages = queue.filter((m) => !existingIds.has(m.id));
  if (newQueueMessages.length === 0) {
    return filtered;
  }

  return [...filtered, ...newQueueMessages];
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

export interface ChatRenderModel {
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

    const todos = todoListOf(message);
    if (todos) {
      if (previousTodos) oldTodosById.set(message.id, previousTodos);
      previousTodos = todos;
      latestTodos = todos;
    }

    if (!isRenderableMessage(message)) continue;
    visible.push(message);
  }

  return { renderItems: groupToolMessages(visible), oldTodosById, hasApproval, latestTodos };
}

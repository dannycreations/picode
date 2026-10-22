import { contentText, uuidv7 } from '@earendil-works/pi-ai';
import { calculateContextTokens, getLastAssistantUsage } from '@earendil-works/pi-coding-agent';

import { clearApprovalDuration, getApprovalDuration } from '@pi-code/extension/structures/agent-runtime/brokers/approval';
import { toBase64DataUrl } from '@pi-code/extension/utilities/codec';
import { logger } from '@pi-code/shared/core/logger';
import { elapsedSeconds, findReplaceableFailedRequest, parseTextAttachment, resolveContextLimit } from '@pi-code/shared/utilities/common';
import { buildToolSections } from '@pi-code/shared/utilities/tool';

import type { ImageContent, TextContent, ThinkingContent, ToolCall, Usage } from '@earendil-works/pi-ai';
import type { AgentSession, SessionEntry, SessionEntryBase, SessionMessageEntry } from '@earendil-works/pi-coding-agent';
import type {
  Attachment,
  ChatMessage,
  StatsData,
  TextAttachment,
  ToolArguments,
  ToolChatMessage,
  ToolName,
  ToolResultDetails,
} from '@pi-code/shared/core/types';

type MessageContentPart = TextContent | ThinkingContent | ToolCall | ImageContent;

function toContentParts(content: string | readonly MessageContentPart[]): readonly MessageContentPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content;
}

function joinThinking(parts: readonly MessageContentPart[]): string {
  let text = '';
  let hasText = false;
  for (const part of parts) {
    if (part.type !== 'thinking') continue;
    text = hasText ? `${text}\n${part.thinking}` : part.thinking;
    hasText = true;
  }
  return text;
}

function collectImageAttachments(parts: readonly MessageContentPart[]): Attachment[] {
  const attachments: Attachment[] = [];
  for (const part of parts) {
    if (part.type !== 'image') continue;
    attachments.push({ kind: 'image' as const, dataUrl: toBase64DataUrl(part.data, part.mimeType) });
  }
  return attachments;
}

export function convertSessionEntries(entries: readonly SessionEntry[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) byId.set(entry.id, entry);
  const textAttachmentsByUser = collectTextAttachments(entries, byId);

  for (const entry of entries) {
    const timestamp = new Date(entry.timestamp).getTime();

    switch (entry.type) {
      case 'compaction':
        result.push({ id: entry.id, sender: 'compaction', text: entry.summary, cost: entry.usage?.cost?.total, timestamp });
        break;

      case 'label':
        if (entry.label) {
          result.push({ id: entry.id, sender: 'checkpoint', text: 'Checkpoint saved', timestamp });
        }
        break;

      case 'message':
        appendMessage(result, entry.id, entry.message, timestamp, textAttachmentsByUser.get(entry.id));
        break;
    }
  }

  return result;
}

type SessionMessage = Extract<SessionEntry, { type: 'message' }>['message'];

function collectTextAttachments(entries: readonly SessionEntry[], byId: Map<string, SessionEntry>): Map<string, TextAttachment[]> {
  const map = new Map<string, TextAttachment[]>();

  for (const entry of entries) {
    if (entry.type !== 'custom_message' || entry.customType !== 'text_attachment') continue;

    const attachment = parseTextAttachment(entry.content);
    if (!attachment) continue;

    const userId = findUserMessageAncestorId(entry, byId);
    if (!userId) continue;

    const list = map.get(userId);
    if (list) list.push(attachment);
    else map.set(userId, [attachment]);
  }

  return map;
}

function findUserMessageAncestorId(entry: SessionEntryBase, byId: Map<string, SessionEntry>): string | null {
  // A chain can never be longer than the entry list, so a corrupt parent link
  // ends the walk instead of looping forever.
  const limit = byId.size + 1;
  let current: SessionEntryBase | undefined = entry;
  for (let step = 0; current !== undefined && step < limit; step++) {
    if (current.type === 'message' && (current as SessionMessageEntry).message.role === 'user') {
      return current.id;
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

function appendMessage(result: ChatMessage[], id: string, msg: SessionMessage, timestamp: number, textAttachments?: readonly TextAttachment[]): void {
  switch (msg.role) {
    case 'user': {
      const imageAttachments = collectImageAttachments(toContentParts(msg.content));
      const attachments = [...imageAttachments, ...(textAttachments ?? [])];
      result.push({
        id,
        sender: 'user',
        text: contentText(msg.content).trim(),
        attachments: attachments.length > 0 ? attachments : undefined,
        timestamp,
      });
      break;
    }

    case 'assistant':
      appendAssistantTurn(result, id, msg, timestamp);
      break;

    // A tool result is not a row of its own: it completes the `tool` row that
    // the assistant's matching tool call already pushed.
    case 'toolResult':
      patchToolCall(result, msg, timestamp);
      break;

    case 'bashExecution':
      result.push({
        id,
        sender: 'tool',
        text: msg.command,
        toolName: 'execute_command',
        toolArgs: { command: msg.command },
        toolStatus: msg.cancelled ? 'denied' : 'completed',
        diff: msg.output,
        duration: 0,
        timestamp,
      });
      break;

    default:
      logger.warn(`Unhandled session message role during transcript conversion: ${msg.role}`);
      break;
  }
}

function appendAssistantTurn(result: ChatMessage[], id: string, msg: Extract<SessionMessage, { role: 'assistant' }>, timestamp: number): void {
  const parts = toContentParts(msg.content);
  const cost = msg.usage?.cost?.total;
  const errorMessage = msg.errorMessage;

  // A retry after a failed turn reuses that turn's row, so a chain of failed
  // attempts replays as one request until a turn succeeds.
  const requestRow: ChatMessage = {
    id: `${id}-api-req`,
    sender: 'api_request',
    text: 'API Request',
    timestamp: timestamp - 1,
    toolStatus: errorMessage ? 'denied' : 'completed',
    errorMessage,
    cost,
  };
  const retryIndex = findReplaceableFailedRequest(result);
  if (retryIndex !== undefined) result.splice(retryIndex);
  result.push(requestRow);

  result.push({
    id,
    sender: 'assistant',
    text: contentText(msg.content),
    reasoning: joinThinking(parts),
    cost,
    timestamp,
  });

  // The agent loop drops an errored or aborted turn as a hard exit before
  // dispatching that turn's tool calls, and the live path posts no tool card
  // for one. Rebuilding a completed row here would show a call that never ran,
  // often with arguments the aborted stream left empty. The api_request row
  // above already carries the failure notice.
  const dispatchedTools = msg.stopReason !== 'error' && msg.stopReason !== 'aborted';
  if (dispatchedTools) {
    for (const part of parts) {
      if (part.type !== 'toolCall') continue;
      const toolCall = part;
      result.push({
        id: toolCall.id || uuidv7(),
        sender: 'tool',
        text: toolCall.name,
        toolName: toolCall.name as ToolName,
        toolArgs: toolCall.arguments as ToolArguments,
        toolStatus: 'completed',
        timestamp,
      });
    }
  }
}

function patchToolCall(result: ChatMessage[], msg: Extract<SessionMessage, { role: 'toolResult' }>, timestamp: number): void {
  const index = result.findIndex((r) => r.sender === 'tool' && r.id === msg.toolCallId);
  if (index === -1) return;

  const existing = result[index] as ToolChatMessage;

  const resultText = contentText(msg.content);
  const details = msg.details as ToolResultDetails;

  const rawDuration = elapsedSeconds(existing.timestamp, timestamp);
  const approvalMs = getApprovalDuration(msg.toolCallId);
  clearApprovalDuration(msg.toolCallId);
  const netDuration = approvalMs !== undefined ? elapsedSeconds(existing.timestamp, timestamp - approvalMs) : rawDuration;

  result[index] = {
    ...existing,
    toolStatus: details?.cancelled ? 'cancelled' : msg.isError ? 'denied' : 'completed',
    exitCode: details?.exitCode ?? existing.exitCode,
    diff: details?.diff || resultText,
    todos: details?.todos,
    files: details?.files,
    duration: details?.duration !== undefined ? details.duration : netDuration,
    errorMessage: msg.isError ? resultText : existing.errorMessage,
    subtitle: details?.subtitle,
  };
}

function calculateSessionStats(entries: readonly SessionEntry[], contextLimit: number): StatsData {
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheWrites = 0;
  let cacheReads = 0;
  let totalCost = 0;
  let contextTokens = 0;

  const addUsage = (usage: Usage | undefined): void => {
    if (!usage) return;
    tokensIn += usage.input;
    tokensOut += usage.output;
    cacheReads += usage.cacheRead;
    cacheWrites += usage.cacheWrite;
    totalCost += usage.cost.total;
  };

  for (const entry of entries) {
    if (entry.type === 'compaction' || entry.type === 'branch_summary') {
      addUsage(entry.usage);
    } else if (entry.type === 'message' && (entry.message.role === 'assistant' || entry.message.role === 'toolResult')) {
      addUsage(entry.message.usage);
    }
  }

  try {
    const lastUsage = getLastAssistantUsage([...entries]);
    if (lastUsage) {
      contextTokens = calculateContextTokens(lastUsage);
    }
  } catch (err) {
    logger.error('Failed to get last assistant usage:', err);
  }

  return {
    tokensIn,
    tokensOut,
    cacheWrites,
    cacheReads,
    totalCost,
    contextTokens,
    contextLimit,
  };
}

export function loadSessionTranscript(entries: readonly SessionEntry[], contextLimit: number): { messages: ChatMessage[]; stats: StatsData } {
  const messages = convertSessionEntries(entries);
  fillToolSections(messages);
  const stats = calculateSessionStats(entries, contextLimit);
  return { messages, stats };
}

export function loadSubagentTranscript(session: AgentSession, task: string): { messages: ChatMessage[]; stats: StatsData } {
  const entries = session.sessionManager.getBranch();
  const context = resolveContextLimit(session.model?.contextWindow);
  const { messages, stats } = loadSessionTranscript(entries, context);

  // The child receives the agent's standing instructions and the brief as one
  // prompt, so the first user row shows only the brief the user delegated.
  const briefIndex = messages.findIndex((message) => message.sender === 'user');
  if (briefIndex !== -1) messages[briefIndex] = { ...messages[briefIndex], text: task };

  // A tool whose result has not arrived is still going, and a tool waiting on
  // an approval is waiting on the user. Replaying it as finished would claim
  // work that never happened.
  const finishedToolCalls = new Set(
    entries.flatMap((entry) => (entry.type === 'message' && entry.message.role === 'toolResult' ? [entry.message.toolCallId] : [])),
  );
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.sender !== 'tool' || finishedToolCalls.has(message.id)) continue;
    messages[index] = { ...message, toolStatus: 'running' };
  }

  // A response that is still streaming is not in the transcript yet, so its row
  // is rebuilt from the live message. Without it the text streamed after the
  // session was opened would land on the previous response.
  const streaming = session.agent.state.streamingMessage;
  if (streaming?.role === 'assistant') {
    const rows: ChatMessage[] = [];
    appendAssistantTurn(rows, `streaming-${session.sessionId}`, streaming, streaming.timestamp);
    for (const row of rows) messages.push(withToolSections(row));
  }

  return { messages, stats };
}

function withToolSections(message: ChatMessage): ChatMessage {
  return message.sender === 'tool' ? { ...message, toolSections: buildToolSections(message) } : message;
}

function fillToolSections(messages: ChatMessage[]): void {
  // The tool rows carry their sections, so the webview does not rebuild them
  // on every render. Filling them in place keeps the transcript one array
  // instead of a converted copy plus a sectioned copy.
  for (let index = 0; index < messages.length; index++) {
    messages[index] = withToolSections(messages[index]);
  }
}

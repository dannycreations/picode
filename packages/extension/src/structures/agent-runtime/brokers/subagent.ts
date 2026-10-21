import { unregisterSubagentSession } from '@pi-code/extension/structures/agent-runtime/brokers/tool-call';
import { logger } from '@pi-code/shared/core/logger';

import type { AgentSession } from '@earendil-works/pi-coding-agent';

export interface LiveSubagent {
  readonly name: string;
  readonly toolCallId: string;
  readonly task: string;
  readonly ready: Promise<AgentSession>;
  session: AgentSession | null;
}

interface LiveSubagentEntry extends LiveSubagent {
  sessionId: string | undefined;
  attach: (session: AgentSession) => void;
}

const liveSubagents = new Map<string, LiveSubagentEntry>();

type SessionsListener = (toolCallIds: readonly string[]) => void;

const listeners = new Set<SessionsListener>();

export function liveSubagentToolCallIds(): readonly string[] {
  return [...liveSubagents.values()].filter((entry) => entry.session !== null).map((entry) => entry.toolCallId);
}

export function onSubagentSessionsChanged(listener: SessionsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifySessionsChanged(): void {
  if (listeners.size === 0) return;
  const toolCallIds = liveSubagentToolCallIds();
  for (const listener of listeners) listener(toolCallIds);
}

export function registerLiveSubagent(name: string, toolCallId: string, task: string): void {
  let attach!: (session: AgentSession) => void;
  const ready = new Promise<AgentSession>((resolve) => {
    attach = resolve;
  });
  liveSubagents.set(toolCallId, { name, toolCallId, task, session: null, sessionId: undefined, ready, attach });
}

export function attachLiveSubagentSession(toolCallId: string, session: AgentSession): void {
  const entry = liveSubagents.get(toolCallId);
  if (!entry) return;
  entry.session = session;
  entry.sessionId = session.sessionId;
  entry.attach(session);
  notifySessionsChanged();
}

export function getLiveSubagent(toolCallId: string): LiveSubagent | undefined {
  return liveSubagents.get(toolCallId);
}

function disposeEntry(entry: LiveSubagentEntry): void {
  if (entry.sessionId) unregisterSubagentSession(entry.sessionId);
  try {
    entry.session?.dispose();
  } catch (err) {
    logger.error('Failed to dispose sub-agent session:', err);
  }
}

export function unregisterLiveSubagent(toolCallId: string): void {
  const entry = liveSubagents.get(toolCallId);
  if (!entry) return;
  liveSubagents.delete(toolCallId);
  disposeEntry(entry);
  notifySessionsChanged();
}

export function releaseLiveSubagents(): void {
  if (liveSubagents.size === 0) return;
  for (const entry of liveSubagents.values()) {
    disposeEntry(entry);
  }
  liveSubagents.clear();
  notifySessionsChanged();
}

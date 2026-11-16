import { logger } from '@pi-code/shared/core/logger';

import type { AgentSession } from '@earendil-works/pi-coding-agent';

export interface LiveSubagent {
  readonly toolCallId: string;
  readonly description: string;
  readonly task: string;
  readonly ready: Promise<AgentSession | null>;
  session: AgentSession | null;
}

interface LiveSubagentEntry extends LiveSubagent {
  readonly attach: (session: AgentSession | null) => void;
}

const liveSubagents = new Map<string, LiveSubagentEntry>();

const subagentBySession = new Map<string, string>();

export function registerSubagentSession(sessionId: string, toolCallId: string): void {
  subagentBySession.set(sessionId, toolCallId);
}

export function unregisterSubagentSession(sessionId: string): void {
  subagentBySession.delete(sessionId);
}

export function isSubagentSession(sessionId: string): boolean {
  return subagentBySession.has(sessionId);
}

export function getSubagentSession(sessionId: string): string | undefined {
  return subagentBySession.get(sessionId);
}

type SessionsListener = (toolCallIds: readonly string[]) => void;

let sessionsListener: SessionsListener | null = null;

export function liveSubagentToolCallIds(): readonly string[] {
  return [...liveSubagents.values()].filter((entry) => entry.session !== null).map((entry) => entry.toolCallId);
}

export function onSubagentSessionsChanged(listener: SessionsListener): () => void {
  sessionsListener = listener;
  return () => {
    if (sessionsListener === listener) sessionsListener = null;
  };
}

function notifySessionsChanged(): void {
  sessionsListener?.(liveSubagentToolCallIds());
}

export function registerLiveSubagent(toolCallId: string, description: string, task: string): void {
  let attach!: (session: AgentSession | null) => void;
  const ready = new Promise<AgentSession | null>((resolve) => {
    attach = resolve;
  });
  liveSubagents.set(toolCallId, { toolCallId, description, task, session: null, ready, attach });
}

export function attachLiveSubagentSession(toolCallId: string, session: AgentSession): void {
  const entry = liveSubagents.get(toolCallId);
  if (!entry) return;
  entry.session = session;
  entry.attach(session);
  notifySessionsChanged();
}

export function getLiveSubagent(toolCallId: string): LiveSubagent | undefined {
  return liveSubagents.get(toolCallId);
}

function disposeEntry(entry: LiveSubagentEntry): void {
  // Settle a still-pending `ready` so anyone waiting on a sub-agent that was
  // torn down mid-start does not hang.
  entry.attach(null);
  if (entry.session) unregisterSubagentSession(entry.session.sessionId);
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

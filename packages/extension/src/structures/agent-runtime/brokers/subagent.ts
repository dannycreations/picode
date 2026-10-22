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
  attach: (session: AgentSession) => void;
}

const liveSubagents = new Map<string, LiveSubagentEntry>();

interface SubagentSessionInfo {
  readonly name: string;
  readonly toolCallId?: string;
}

const subagentBySession = new Map<string, SubagentSessionInfo>();

export function registerSubagentSession(sessionId: string, name: string, toolCallId?: string): void {
  subagentBySession.set(sessionId, { name, toolCallId });
}

export function unregisterSubagentSession(sessionId: string): void {
  subagentBySession.delete(sessionId);
}

export function getSubagentSession(sessionId: string): SubagentSessionInfo | undefined {
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

export function registerLiveSubagent(name: string, toolCallId: string, task: string): void {
  let attach!: (session: AgentSession) => void;
  const ready = new Promise<AgentSession>((resolve) => {
    attach = resolve;
  });
  liveSubagents.set(toolCallId, { name, toolCallId, task, session: null, ready, attach });
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

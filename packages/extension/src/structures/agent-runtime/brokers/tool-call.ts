// Child sessions are tagged so shared flows can label events and confirmation
// prompts with the delegating agent's name instead of an opaque session id.
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

// How long each approval took, keyed by tool call id. A reloaded transcript
// subtracts this pause so tool durations report net execution time.
const approvalDurations = new Map<string, number>();

export function getApprovalDuration(toolCallId: string): number | undefined {
  return approvalDurations.get(toolCallId);
}

export function recordApprovalDuration(toolCallId: string, durationMs: number): void {
  approvalDurations.set(toolCallId, durationMs);
}

export function clearApprovalDurations(): void {
  approvalDurations.clear();
}

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

interface ToolAbortState {
  readonly controller: AbortController;
  cancelled: boolean;
}

const toolAbortByCallId = new Map<string, ToolAbortState>();

export interface ToolAbort {
  readonly signal: AbortSignal;
  readonly cancelled: boolean;
  readonly dispose: () => void;
}

export function createToolAbort(toolCallId: string, runSignal?: AbortSignal): ToolAbort {
  const state: ToolAbortState = { controller: new AbortController(), cancelled: false };
  toolAbortByCallId.set(toolCallId, state);

  // The run tears the call down as well, so the tool only ever watches the
  // one signal this handle hands out.
  const onRunAbort = (): void => state.controller.abort(runSignal?.reason);
  if (runSignal) {
    if (runSignal.aborted) onRunAbort();
    else runSignal.addEventListener('abort', onRunAbort, { once: true });
  }

  return {
    signal: state.controller.signal,
    get cancelled(): boolean {
      return state.cancelled;
    },
    dispose: () => {
      if (toolAbortByCallId.get(toolCallId) === state) toolAbortByCallId.delete(toolCallId);
      runSignal?.removeEventListener('abort', onRunAbort);
    },
  };
}

export function abortToolCall(toolCallId: string): boolean {
  const state = toolAbortByCallId.get(toolCallId);
  if (!state) return false;
  state.cancelled = true;
  state.controller.abort();
  return true;
}

// How long each approval took, keyed by tool call id. A reloaded transcript
// subtracts this pause so tool durations report net execution time.
const approvalDurations = new Map<string, number>();

export function getApprovalDuration(toolCallId: string): number | undefined {
  return approvalDurations.get(toolCallId);
}

export function clearApprovalDuration(toolCallId: string): void {
  approvalDurations.delete(toolCallId);
}

export function clearAllApprovalDurations(): void {
  approvalDurations.clear();
}

export function recordApprovalDuration(toolCallId: string, durationMs: number): void {
  approvalDurations.set(toolCallId, durationMs);
}

interface ToolAbortState {
  readonly controller: AbortController;
  cancelled: boolean;
}

const toolAbortByCallId = new Map<string, ToolAbortState>();

interface ToolAbort {
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { coerceSetting, SETTING_KEYS } from '@pi-code/shared/core/settings';
import { selectThinkingLevel, setComposerTextarea, useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { ExtensionToWebviewMessage, ModelItem, ModelSelection } from '@pi-code/shared/core/protocol';
import type { AppSettings } from '@pi-code/shared/core/settings';
import type { ChatMessage, StatsData } from '@pi-code/shared/core/types';

const stats = (contextTokens: number): StatsData => ({
  tokensIn: 1000,
  tokensOut: 500,
  cacheReads: 0,
  cacheWrites: 0,
  totalCost: 0.5,
  contextTokens,
  contextLimit: 200_000,
});

// Replays the messages the extension posts for an auto-compaction that fires
// when a running turn crosses the context threshold.
const TURN_SEQUENCE: readonly ExtensionToWebviewMessage[] = [
  { type: 'agent_start', payload: { path: '/tmp/task.json', stats: stats(200_000) } },
  { type: 'compaction_start' },
  { type: 'agent_settled', payload: stats(200_000) },
  { type: 'agent_start', payload: { path: '/tmp/task.json', stats: stats(200_000) } },
  { type: 'compaction_end', payload: { ...stats(40_000), compactionEntry: { id: 'cmp-1', summary: 'Earlier work summary' } } },
];

function apply(messages: readonly ExtensionToWebviewMessage[]): void {
  for (const message of messages) {
    useChatStore.getState().applyMessage(message);
  }
}

describe('useChatStore compaction', () => {
  beforeEach(() => {
    apply([
      { type: 'session_loaded', payload: { id: 'task-1', title: 'Task', messages: [], path: '/tmp/task.json', isArchived: false, ...stats(0) } },
    ]);
  });

  it('keeps the compacting banner up across the turn that triggered it and the turn that follows', () => {
    const store = useChatStore.getState();
    store.applyMessage(TURN_SEQUENCE[0]);
    store.applyMessage(TURN_SEQUENCE[1]);
    expect(useChatStore.getState().isCompacting).toBe(true);

    // The triggering turn settles and its follow-up starts while the
    // summarization request is still in flight.
    store.applyMessage(TURN_SEQUENCE[2]);
    expect(useChatStore.getState().isCompacting).toBe(true);
    store.applyMessage(TURN_SEQUENCE[3]);
    expect(useChatStore.getState().isCompacting).toBe(true);

    store.applyMessage(TURN_SEQUENCE[4]);
    expect(useChatStore.getState().isCompacting).toBe(false);
  });

  it('appends the compaction summary to the open task', () => {
    apply(TURN_SEQUENCE);

    const messages = useChatStore.getState().activeTask?.messages ?? [];
    expect(messages).toEqual([{ id: 'cmp-1', sender: 'compaction', text: 'Earlier work summary', cost: undefined, timestamp: expect.any(Number) }]);
  });
});

const model = (id: string, thinkingLevels: ModelItem['thinkingLevels'], provider = 'test'): ModelItem => ({
  id,
  name: id,
  provider,
  thinkingLevels,
});

const select = (id: string, provider = 'test'): ModelSelection => ({ id, provider });

describe('memoized chat chrome', () => {
  beforeEach(() => {
    apply([{ type: 'session_loaded', payload: { id: 'task-1', title: 'Task', messages: [], path: '/tmp/task.json', ...stats(0) } }]);
    useChatStore.setState({ models: [model('deep', ['high'])], selectedModel: select('deep') });
  });

  it('keeps every prop the composer and footer depend on identical across a streamed token', () => {
    // `ChatInput` and `ChatFooter` are memoized, so a token that rebuilds
    // `activeTask` must not disturb the store values they read. If any of these
    // identities changed, the memo would silently never hit again.
    const before = useChatStore.getState();

    useChatStore.getState().applyMessage({ type: 'stream_delta', payload: { text: 'hello' } });

    const after = useChatStore.getState();
    expect(after.activeTask).not.toBe(before.activeTask);
    expect(after.models).toBe(before.models);
    expect(after.selectedModel).toBe(before.selectedModel);
    expect(after.selectedThinkingLevel).toBe(before.selectedThinkingLevel);
    expect(selectThinkingLevel(after)).toBe(selectThinkingLevel(before));
  });
});

describe('tool completion', () => {
  beforeEach(() => {
    apply([{ type: 'session_loaded', payload: { id: 'task-1', title: 'Task', messages: [], path: '/tmp/task.json', ...stats(0) } }]);
  });

  it('renders the diff and duration the tool reported instead of re-deriving them', () => {
    apply([
      {
        type: 'tool_execution_start',
        payload: { id: 't1', tool_name: 'spawn_subagent', arguments: { agent: 'explore', description: 'd', task: 't' } },
      },
    ]);
    apply([
      {
        type: 'tool_execution_end',
        payload: { id: 't1', result: 'truncated report', diff: 'full report', duration: 42, is_error: false },
      },
    ]);

    const [row] = useChatStore.getState().activeTask?.messages ?? [];
    // Both come from the tool, so the row survives a reload unchanged.
    expect(row).toMatchObject({ diff: 'full report', duration: 42 });
  });

  it('falls back to the streamed result and wall clock when the tool reports neither', () => {
    apply([{ type: 'tool_execution_start', payload: { id: 't1', tool_name: 'execute_command', arguments: { command: 'ls' } } }]);
    apply([{ type: 'tool_execution_end', payload: { id: 't1', result: 'a.ts', is_error: false } }]);

    const [row] = useChatStore.getState().activeTask?.messages ?? [];
    expect(row).toMatchObject({ diff: 'a.ts' });
    expect(typeof (row as { duration?: number }).duration).toBe('number');
  });

  it('marks a call the user stopped as cancelled rather than failed', () => {
    apply([{ type: 'tool_execution_start', payload: { id: 't1', tool_name: 'execute_command', arguments: { command: 'ls' } } }]);
    apply([
      {
        type: 'tool_execution_end',
        payload: { id: 't1', result: 'stopped', is_error: true, exit_code: null, cancelled: true },
      },
    ]);

    const [row] = useChatStore.getState().activeTask?.messages ?? [];
    expect(row).toMatchObject({ toolStatus: 'cancelled' });
  });
});

describe('api request failure', () => {
  beforeEach(() => {
    apply([{ type: 'session_loaded', payload: { id: 'task-1', title: 'Task', messages: [], path: '/tmp/task.json', ...stats(0) } }]);
  });

  it('marks the request row failed so the error renders without a reload', () => {
    apply([
      { type: 'api_request_start', payload: { id: 'req-1', timestamp: 1 } },
      // The assistant message carrying the failure closes the request row
      // before the turn reports its final error against it.
      { type: 'message_start', payload: { timestamp: 2 } },
      { type: 'message_end', payload: { cost: 0.1 } },
      { type: 'api_request_end', payload: { id: 'req-1', cost: 0.1, error: 'API request failed' } },
    ]);

    const [row] = useChatStore.getState().activeTask?.messages ?? [];
    expect(row).toMatchObject({
      id: 'req-1',
      sender: 'api_request',
      toolStatus: 'denied',
      errorMessage: 'API request failed',
      cost: 0.1,
    });
  });

  it('replaces the failed request row inline instead of stacking retry headers', () => {
    apply([
      { type: 'api_request_start', payload: { id: 'req-1', timestamp: 1 } },
      { type: 'message_start', payload: { timestamp: 2 } },
      { type: 'api_request_end', payload: { id: 'req-1', error: 'first failure' } },
      { type: 'api_request_start', payload: { id: 'req-2', timestamp: 3 } },
      { type: 'message_start', payload: { timestamp: 4 } },
      { type: 'api_request_end', payload: { id: 'req-2', error: 'second failure' } },
    ]);

    const requests = (useChatStore.getState().activeTask?.messages ?? []).filter((m) => m.sender === 'api_request');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ id: 'req-2', toolStatus: 'denied', errorMessage: 'second failure' });
  });

  it('counts down the pending retry on the failed row and clears it when the chain ends', () => {
    const before = Date.now();
    apply([
      { type: 'api_request_start', payload: { id: 'req-1', timestamp: 1 } },
      { type: 'api_request_end', payload: { id: 'req-1', error: 'overloaded' } },
    ]);

    apply([{ type: 'api_retry_start', payload: { delayMs: 4000 } }]);
    const waiting = useChatStore.getState().activeTask?.messages ?? [];
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ id: 'req-1', retryAt: expect.any(Number) });
    const retryAt = (waiting[0] as { retryAt?: number }).retryAt ?? 0;
    expect(retryAt).toBeGreaterThanOrEqual(before + 4000);

    // The retry fires and its turn takes the row over, which drops the deadline.
    apply([{ type: 'api_retry_end' }, { type: 'api_request_start', payload: { id: 'req-2', timestamp: 2 } }]);
    const requests = (useChatStore.getState().activeTask?.messages ?? []).filter((m) => m.sender === 'api_request');
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty('retryAt');
  });

  it('drops a pending countdown once the retried request is in flight', () => {
    apply([
      { type: 'api_request_start', payload: { id: 'req-1', timestamp: 1 } },
      { type: 'message_start', payload: { timestamp: 2 } },
      { type: 'stream_delta', payload: { text: 'partial answer' } },
      { type: 'message_end', payload: {} },
      { type: 'api_request_end', payload: { id: 'req-1', error: 'stream terminated' } },
      { type: 'api_retry_start', payload: { delayMs: 4000 } },
    ]);
    // Streamed text keeps the failed row on screen, so this retry appends a
    // request row instead of replacing the one holding the deadline.
    expect(useChatStore.getState().activeTask?.messages).toHaveLength(2);

    apply([{ type: 'api_request_start', payload: { id: 'req-2', timestamp: 3 } }]);

    const messages = useChatStore.getState().activeTask?.messages ?? [];
    expect(messages.filter((m) => m.sender === 'api_request')).toHaveLength(2);
    expect(messages.every((m) => (m as { retryAt?: number }).retryAt === undefined)).toBe(true);
  });

  it('clears a countdown left on the row when the retries run out', () => {
    apply([
      { type: 'api_request_start', payload: { id: 'req-1', timestamp: 1 } },
      { type: 'api_request_end', payload: { id: 'req-1', error: 'overloaded' } },
      { type: 'api_retry_start', payload: { delayMs: 4000 } },
      { type: 'api_retry_end' },
    ]);

    const [row] = useChatStore.getState().activeTask?.messages ?? [];
    expect(row).toMatchObject({ id: 'req-1', toolStatus: 'denied', errorMessage: 'overloaded' });
    expect((row as { retryAt?: number }).retryAt).toBeUndefined();
  });
});

describe('model catalog refresh', () => {
  // init_data requires a full settings snapshot; the defaults keep it irrelevant here.
  const settings = Object.fromEntries(SETTING_KEYS.map((key) => [key, coerceSetting(key, undefined)])) as AppSettings;
  const initData = (models: ModelItem[], defaultModel?: ModelSelection): ExtensionToWebviewMessage => ({
    type: 'init_data',
    payload: { models, default_model: defaultModel, settings, commands: [] },
  });

  beforeEach(() => {
    useChatStore.setState({ models: [], selectedModel: select(''), selectedThinkingLevel: null });
  });

  it('lands on the persisted default once the refreshed catalog carries it', () => {
    // init_data kept the persisted selection even though the local catalog had
    // no zen models. models_data is the first list that can actually serve it.
    apply([initData([model('claude-opus-4-8', ['high'])], select('stealth-alpha', 'zen'))]);
    expect(useChatStore.getState().selectedModel).toEqual(select('stealth-alpha', 'zen'));

    apply([{ type: 'models_data', payload: { models: [model('claude-opus-4-8', ['high']), model('stealth-alpha', ['low', 'high'], 'zen')] } }]);
    expect(useChatStore.getState().selectedModel).toEqual(select('stealth-alpha', 'zen'));
  });

  it('keeps a selection that the refreshed catalog still offers', () => {
    apply([initData([model('claude-opus-4-8', ['high'])], select('claude-opus-4-8'))]);
    apply([{ type: 'models_data', payload: { models: [model('claude-opus-4-8', ['high']), model('stealth-alpha', ['low'])] } }]);
    expect(useChatStore.getState().selectedModel).toEqual(select('claude-opus-4-8'));
  });

  it('falls back to the refreshed default when the selection is gone and none was persisted', () => {
    apply([initData([], undefined)]);
    apply([{ type: 'models_data', payload: { models: [model('claude-opus-4-8', ['high'])] } }]);
    expect(useChatStore.getState().selectedModel).toEqual(select('claude-opus-4-8'));
  });

  it('clamps the thinking level to the re-resolved model', () => {
    apply([initData([model('claude-opus-4-8', ['high'])], select('stealth-alpha', 'zen'))]);
    useChatStore.setState({ selectedThinkingLevel: 'high' });

    apply([{ type: 'models_data', payload: { models: [model('claude-opus-4-8', ['high']), model('stealth-alpha', ['off', 'low'], 'zen')] } }]);
    expect(useChatStore.getState().selectedModel).toEqual(select('stealth-alpha', 'zen'));
    expect(useChatStore.getState().selectedThinkingLevel).toBe('low');
  });

  it('keeps a same-id model on its own provider when the catalog carries two', () => {
    // The id alone cannot name a model: both providers ship "gpt-5", so the
    // thinking levels shown in the footer must come from the selected one.
    apply([initData([model('gpt-5', ['low'], 'openai'), model('gpt-5', ['high'], 'zen')], select('gpt-5', 'zen'))]);

    expect(useChatStore.getState().selectedModel).toEqual(select('gpt-5', 'zen'));
    expect(selectThinkingLevel(useChatStore.getState())).toBe('high');
  });
});

describe('selectThinkingLevel', () => {
  beforeEach(() => {
    useChatStore.setState({
      models: [model('fast', ['off', 'low']), model('deep', ['high'])],
      selectedModel: select('deep'),
      selectedThinkingLevel: 'low',
    });
  });

  it('clamps a stored level the selected model does not support', () => {
    // "low" is supported by `fast` only, so the deep model falls back.
    expect(selectThinkingLevel(useChatStore.getState())).toBe('high');
  });

  it('keeps a stored level the selected model supports', () => {
    useChatStore.setState({ selectedThinkingLevel: 'high' });
    expect(selectThinkingLevel(useChatStore.getState())).toBe('high');
  });
});

describe('suggestion results', () => {
  beforeEach(() => {
    useChatStore.setState({ searchResults: [], commitResults: null });
  });

  it('drops a reply that answers an older query than the newest one sent', () => {
    // File and commit results arrive out of order, so the menu must show the
    // query that is still in the box rather than whatever landed last.
    const store = useChatStore.getState();
    store.send({ type: 'search_files', query: 'alpha' });
    apply([{ type: 'search_results', payload: { query: 'alpha', paths: ['src/alpha.ts'] } }]);
    expect(useChatStore.getState().searchResults).toEqual(['src/alpha.ts']);

    store.send({ type: 'search_files', query: 'alpha-beta' });
    apply([{ type: 'search_results', payload: { query: 'alpha', paths: ['stale.ts'] } }]);
    expect(useChatStore.getState().searchResults).toEqual(['src/alpha.ts']);

    apply([{ type: 'search_results', payload: { query: 'alpha-beta', paths: ['src/beta.ts'] } }]);
    expect(useChatStore.getState().searchResults).toEqual(['src/beta.ts']);
  });
});

describe('appendToInput', () => {
  // The composer reads its caret from a real textarea, so the range has to be
  // one the store can read synchronously.
  const withSelection = (start: number, end: number) => {
    const textarea = { selectionStart: start, selectionEnd: end, focus: vi.fn(), setSelectionRange: vi.fn() };
    setComposerTextarea({ current: textarea } as never);
    return textarea;
  };

  afterEach(() => setComposerTextarea(null));

  it('replaces the selected range instead of duplicating it', () => {
    // Inserting over a selection used to write at the caret and leave the
    // selected text in place, so the composer's contents doubled up.
    withSelection(5, 12);
    useChatStore.setState({ inputValue: 'keep REPLACE keep' });
    useChatStore.getState().appendToInput('X');
    expect(useChatStore.getState().inputValue).toBe('keep X keep');
  });

  it('inserts at the caret when nothing is selected', () => {
    withSelection(3, 3);
    useChatStore.setState({ inputValue: 'abcdef' });
    useChatStore.getState().appendToInput('X');
    expect(useChatStore.getState().inputValue).toBe('abcXdef');
  });

  it('appends when the composer has not mounted yet', () => {
    useChatStore.setState({ inputValue: 'existing' });
    useChatStore.getState().appendToInput(' more');
    expect(useChatStore.getState().inputValue).toBe('existing more');
  });
});

describe('sub-agent session', () => {
  const subagentTask = {
    id: 'subagent-call-1',
    title: 'explore',
    messages: [],
    ...stats(0),
  };

  beforeEach(() => {
    apply([{ type: 'session_loaded', payload: { id: 'task-1', title: 'Task', messages: [], path: '/tmp/task.json', ...stats(0) } }]);
    apply([
      {
        type: 'subagent_session_opened',
        payload: { toolCallId: 'call-1', task: subagentTask, isRunning: true },
      },
    ]);
  });

  it('shows the sub-agent session instead of the task that delegated the work', () => {
    expect(useChatStore.getState().view).toBe('subagent');
    expect(useChatStore.getState().subagent?.toolCallId).toBe('call-1');
  });

  it('routes a sub-agent event to the sub-agent transcript and leaves the task alone', () => {
    apply([
      { type: 'subagent_event', payload: { toolCallId: 'call-1', event: { type: 'message_start', payload: { timestamp: 5 } } } },
      { type: 'subagent_event', payload: { toolCallId: 'call-1', event: { type: 'stream_delta', payload: { text: 'hello' } } } },
    ]);

    expect(useChatStore.getState().subagent?.task.messages).toEqual([
      { id: 'assistant-5', sender: 'assistant', text: 'hello', timestamp: 5, toolStatus: 'running' },
    ]);
    expect(useChatStore.getState().activeTask?.messages).toEqual([]);
  });

  it('drops an event for a sub-agent that is no longer on screen', () => {
    apply([{ type: 'subagent_event', payload: { toolCallId: 'other', event: { type: 'message_start', payload: { timestamp: 6 } } } }]);

    expect(useChatStore.getState().subagent?.task.messages).toEqual([]);
  });

  it('shows an approval for the open sub-agent in both transcripts', () => {
    // The approval blocks the task as much as it blocks the sub-agent, so it
    // has to be answerable from either side.
    apply([
      {
        type: 'tool_approval_request',
        payload: { id: 'call-2', tool_name: 'write_file', arguments: { path: 'a.ts' }, toolCallId: 'call-1' },
      },
    ]);

    expect(useChatStore.getState().subagent?.task.messages).toHaveLength(1);
    expect(useChatStore.getState().activeTask?.messages).toHaveLength(1);
  });

  it('keeps the approval in the task when the sub-agent session is closed', () => {
    // Closing the sub-agent session throws its transcript away. The task
    // still holds the approval, so the call can never be left unanswerable.
    apply([
      {
        type: 'tool_approval_request',
        payload: { id: 'call-2', tool_name: 'write_file', arguments: { path: 'a.ts' }, toolCallId: 'call-1' },
      },
    ]);
    useChatStore.getState().closeSubagentSession();

    expect(useChatStore.getState().subagent).toBeNull();
    expect(useChatStore.getState().view).toBe('chat');
    expect(useChatStore.getState().activeTask?.messages).toHaveLength(1);
  });

  it('settles the approval in both transcripts when it is answered', () => {
    apply([
      {
        type: 'tool_approval_request',
        payload: { id: 'call-2', tool_name: 'write_file', arguments: { path: 'a.ts' }, toolCallId: 'call-1' },
      },
    ]);
    useChatStore.getState().respondToApproval('call-2', true);

    const status = (messages: ChatMessage[] | undefined): string | undefined => {
      const first = messages?.[0];
      return first?.sender === 'tool' ? first.toolStatus : undefined;
    };
    expect(status(useChatStore.getState().activeTask?.messages)).toBe('running');
    expect(status(useChatStore.getState().subagent?.task.messages)).toBe('running');
  });
});

describe('openable sub-agent sessions', () => {
  it('starts with no sub-agent the user could open', () => {
    // A transcript read back from disk names calls whose session is gone, so
    // the webview must not offer them.
    expect(useChatStore.getState().openableSubagents).toEqual([]);
  });

  it('takes the calls the extension still holds a session for', () => {
    apply([{ type: 'subagent_sessions', payload: { toolCallIds: ['call-1', 'call-2'] } }]);

    expect(useChatStore.getState().openableSubagents).toEqual(['call-1', 'call-2']);
  });

  it('drops the calls again once the extension releases them', () => {
    apply([{ type: 'subagent_sessions', payload: { toolCallIds: ['call-1'] } }]);
    apply([{ type: 'subagent_sessions', payload: { toolCallIds: [] } }]);

    expect(useChatStore.getState().openableSubagents).toEqual([]);
  });
});

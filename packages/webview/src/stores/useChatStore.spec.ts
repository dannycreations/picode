import { beforeEach, describe, expect, it } from 'vitest';

import { selectThinkingLevel, useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { ExtensionToWebviewMessage, ModelItem } from '@pi-code/shared/core/protocol';
import type { StatsData } from '@pi-code/shared/core/types';

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

const model = (id: string, thinkingLevels: ModelItem['thinkingLevels']): ModelItem => ({
  id,
  name: id,
  provider: 'test',
  thinkingLevels,
});

describe('selectThinkingLevel', () => {
  beforeEach(() => {
    useChatStore.setState({ models: [model('fast', ['off', 'low']), model('deep', ['high'])], selectedModel: 'deep', selectedThinkingLevel: 'low' });
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

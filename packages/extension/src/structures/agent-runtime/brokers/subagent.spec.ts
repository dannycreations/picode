import { describe, expect, it } from 'vitest';

import {
  attachLiveSubagentSession,
  getLiveSubagent,
  liveSubagentToolCallIds,
  onSubagentSessionsChanged,
  registerLiveSubagent,
  releaseLiveSubagents,
  unregisterLiveSubagent,
} from '@pi-code/extension/structures/agent-runtime/brokers/subagent';

import type { AgentSession } from '@earendil-works/pi-coding-agent';

function fakeSession(sessionId: string): AgentSession {
  return { sessionId, dispose: () => {} } as unknown as AgentSession;
}

describe('live subagent registry', () => {
  it('knows a sub-agent from the moment its tool call starts', () => {
    // The row the user clicks appears before the sub-agent has a session, so
    // the entry has to exist first or opening it reports a missing session.
    registerLiveSubagent('explore', 'call-1', 'find the leak');

    const entry = getLiveSubagent('call-1');
    expect(entry?.name).toBe('explore');
    expect(entry?.task).toBe('find the leak');
    expect(entry?.session).toBeNull();

    releaseLiveSubagents();
  });

  it('hands out the session once the sub-agent has one', async () => {
    registerLiveSubagent('explore', 'call-2', 'find the leak');
    const session = fakeSession('sub-2');

    const ready = getLiveSubagent('call-2')?.ready;
    attachLiveSubagentSession('call-2', session);

    expect(getLiveSubagent('call-2')?.session).toBe(session);
    expect(await ready).toBe(session);

    releaseLiveSubagents();
  });

  it('forgets a sub-agent that never became usable', () => {
    registerLiveSubagent('explore', 'call-3', 'find the leak');

    unregisterLiveSubagent('call-3');

    expect(getLiveSubagent('call-3')).toBeUndefined();
  });

  it('drops every sub-agent when the task that owns them ends', () => {
    registerLiveSubagent('explore', 'call-4', 'find the leak');
    attachLiveSubagentSession('call-4', fakeSession('sub-4'));

    releaseLiveSubagents();

    expect(getLiveSubagent('call-4')).toBeUndefined();
  });
});

describe('live subagent sessions', () => {
  it('lists only the calls whose session can still be opened', () => {
    registerLiveSubagent('explore', 'call-1', 'find the leak');
    expect(liveSubagentToolCallIds()).toEqual([]);

    attachLiveSubagentSession('call-1', fakeSession('sub-1'));
    expect(liveSubagentToolCallIds()).toEqual(['call-1']);

    releaseLiveSubagents();
  });

  it('announces the calls as they come and go', () => {
    const seen: (readonly string[])[] = [];
    const unsubscribe = onSubagentSessionsChanged((toolCallIds) => seen.push(toolCallIds));

    registerLiveSubagent('explore', 'call-1', 'find the leak');
    attachLiveSubagentSession('call-1', fakeSession('sub-1'));
    unregisterLiveSubagent('call-1');

    expect(seen).toEqual([['call-1'], []]);
    unsubscribe();
  });

  it('stops announcing once the listener is gone', () => {
    const seen: (readonly string[])[] = [];
    const unsubscribe = onSubagentSessionsChanged((toolCallIds) => seen.push(toolCallIds));
    unsubscribe();

    registerLiveSubagent('explore', 'call-1', 'find the leak');
    attachLiveSubagentSession('call-1', fakeSession('sub-1'));

    expect(seen).toEqual([]);
    releaseLiveSubagents();
  });
});

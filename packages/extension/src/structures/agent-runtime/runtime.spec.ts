import { afterEach, describe, expect, it, vi } from 'vitest';

import { Runtime } from '@pi-code/extension/structures/agent-runtime/runtime';
import { logger } from '@pi-code/shared/core/logger';

import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { Webview } from 'vscode';
import type { QueueChatMessage } from '@pi-code/shared/core/types';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  createAgentResources: vi.fn(async () => ({
    resourceLoader: { getSkills: () => ({ skills: [] }), getPrompts: () => ({ prompts: [] }) },
  })),
  applyPersistedModelAndThinking: vi.fn(async () => {}),
  getEnvironmentDetails: vi.fn(async () => ''),
  expandMentions: vi.fn(async (text: string) => ({ text, mentionContent: undefined as string | undefined })),
  injectResourceMessages: vi.fn(async () => {}),
  sendHiddenContent: vi.fn(async () => {}),
  loadSessionTranscript: vi.fn((): { messages: unknown[]; stats: { contextTokens: number } } => ({ messages: [], stats: { contextTokens: 0 } })),
}));

vi.mock('@pi-code/extension/core/settings', () => ({
  getSettingsManager: () => ({
    getDefaultProvider: () => undefined,
    getDefaultModel: () => undefined,
    getDefaultThinkingLevel: () => undefined,
  }),
  readAppSettings: () => ({ enableTodoTool: false, autoCompactContext: true, autoCompactContextPercent: 80 }),
}));

vi.mock('@pi-code/extension/structures/agent-runtime/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pi-code/extension/structures/agent-runtime/session')>()),
  createSession: mocks.createSession,
}));
vi.mock('@pi-code/extension/structures/agent-runtime/resource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pi-code/extension/structures/agent-runtime/resource')>()),
  createAgentResources: mocks.createAgentResources,
}));
vi.mock('@pi-code/extension/structures/agent-runtime/helpers/model-selection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pi-code/extension/structures/agent-runtime/helpers/model-selection')>()),
  applyPersistedModelAndThinking: mocks.applyPersistedModelAndThinking,
}));
vi.mock('@pi-code/extension/structures/chat-session/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pi-code/extension/structures/chat-session/environment')>()),
  getEnvironmentDetails: mocks.getEnvironmentDetails,
}));
vi.mock('@pi-code/extension/structures/chat-command/mention', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pi-code/extension/structures/chat-command/mention')>()),
  expandMentions: mocks.expandMentions,
}));
vi.mock('@pi-code/extension/structures/chat-command/invocation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pi-code/extension/structures/chat-command/invocation')>()),
  injectResourceMessages: mocks.injectResourceMessages,
  sendHiddenContent: mocks.sendHiddenContent,
}));
vi.mock('@pi-code/extension/structures/chat-session/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pi-code/extension/structures/chat-session/session')>()),
  loadSessionTranscript: mocks.loadSessionTranscript,
}));

function makeFakeWebview(): Webview {
  return { postMessage: vi.fn() } as unknown as Webview;
}

// Shape of the services createSession hands back; startTask reads skills and prompts from it.
const SERVICES = { resourceLoader: { getSkills: () => ({ skills: [] }), getPrompts: () => ({ prompts: [] }) } };

// A session shaped for the start/continue paths: prompt drives the run,
// subscribe is called during preparation, and the rest satisfy dispose hooks.
function makeStartableSession(): AgentSession & { prompt: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } {
  return {
    agent: { state: { messages: [] }, steer: vi.fn(), shouldStopAfterTurn: undefined, prepareNextTurnWithContext: undefined },
    sessionManager: { appendMessage: vi.fn(() => 'persisted-id') },
    settingsManager: { applyOverrides: vi.fn() },
    sessionFile: '/tmp/task.json',
    sessionId: 'session-1',
    isStreaming: false,
    subscribe: vi.fn(() => () => {}),
    sendCustomMessage: vi.fn(async () => undefined),
    prompt: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(),
  } as unknown as AgentSession & { prompt: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
}

// Drain the microtask queue enough for an awaited preparation to resume.
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.createAgentResources.mockResolvedValue({
    resourceLoader: { getSkills: () => ({ skills: [] }), getPrompts: () => ({ prompts: [] }) },
  });
  mocks.getEnvironmentDetails.mockResolvedValue('');
});

function makeFakeSession(steer: () => void, appendMessage: ReturnType<typeof vi.fn> = vi.fn(() => 'persisted-id')): AgentSession {
  return {
    agent: {
      steer,
      shouldStopAfterTurn: undefined,
      prepareNextTurnWithContext: undefined,
    },
    sessionManager: {
      appendMessage,
    },
    settingsManager: {
      applyOverrides: vi.fn(),
    },
  } as unknown as AgentSession;
}

// Queue CRUD lives in reply-queue.spec.ts; these cover how Runtime delivers
// queued replies into a live turn through the installed session hooks.
describe('Runtime reply queue steering', () => {
  it('drains queued replies into the running session via steer on the next turn', async () => {
    const steer = vi.fn();
    const session = makeFakeSession(steer);
    const webview = makeFakeWebview();
    const runtime = new Runtime(webview);

    runtime.replyQueue.add('Hello World');
    runtime.replyQueue.add('Second Message');
    runtime['bindSessionHooks'](session);

    const prepare = session.agent.prepareNextTurnWithContext!;
    await prepare({} as Parameters<typeof prepare>[0], new AbortController().signal);

    expect(steer).toHaveBeenCalledTimes(2);
    expect(steer.mock.calls[0][0].role).toBe('user');
    expect(steer.mock.calls[0][0].content[0].text).toBe('Hello World');
    expect(steer.mock.calls[1][0].content[0].text).toBe('Second Message');
    expect(runtime.replyQueue.all()).toEqual([]);

    const delivered = (webview.postMessage as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0])
      .find((msg) => msg.type === 'reply_queue_delivered');
    expect(delivered).toEqual({
      type: 'reply_queue_delivered',
      payload: {
        messages: [
          expect.objectContaining({ sender: 'user', text: 'Hello World' }),
          expect.objectContaining({ sender: 'user', text: 'Second Message' }),
        ],
      },
    });
  });

  it('keeps queued replies that fail to steer and retries them next turn', async () => {
    const steer = vi.fn(() => {
      throw new Error('boom');
    });
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const session = makeFakeSession(steer);
    const runtime = new Runtime(makeFakeWebview());

    runtime.replyQueue.add('Stays');
    runtime['bindSessionHooks'](session);

    const prepare = session.agent.prepareNextTurnWithContext!;
    await prepare({} as Parameters<typeof prepare>[0], new AbortController().signal);

    expect(steer).toHaveBeenCalledTimes(1);
    expect(runtime.replyQueue.all().map((m) => m.text)).toEqual(['Stays']);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('returns the hidden mention so it can attach to the same turn context', async () => {
    const steer = vi.fn();
    const session = makeFakeSession(steer);
    const runtime = new Runtime(makeFakeWebview());
    const cwd = 'c:/cwd';
    const msg: QueueChatMessage = { id: 'q1', sender: 'queue', text: '@file x', attachments: [], ts: 1 };

    mocks.expandMentions.mockResolvedValueOnce({
      text: 'text with @file',
      mentionContent: 'EXPANDED_FILE_CONTENT',
    });

    const result = await runtime['steerQueuedReply'](msg, cwd, session);

    expect(result.steered).toBe(true);
    expect(result.mention).toMatchObject({
      role: 'custom',
      customType: 'mention_content',
      content: 'EXPANDED_FILE_CONTENT',
      display: false,
    });
    expect(steer).toHaveBeenCalledTimes(1);
    expect(steer.mock.calls[0][0].content).toEqual([{ type: 'text', text: 'text with @file' }]);
    // The mention is persisted as a hidden custom message and rides in the turn
    // context for the model; no steer/nextTurn custom message is sent separately.
    expect(mocks.sendHiddenContent).toHaveBeenCalledWith(session, 'mention_content', 'EXPANDED_FILE_CONTENT', {
      triggerTurn: false,
    });
  });

  it('collects hidden mentions from drained queued replies', async () => {
    const steer = vi.fn();
    const session = makeFakeSession(steer);
    const runtime = new Runtime(makeFakeWebview());

    mocks.expandMentions
      .mockResolvedValueOnce({ text: 'plain reply expanded', mentionContent: undefined })
      .mockResolvedValueOnce({ text: 'mention reply expanded', mentionContent: 'FILE_CONTENT' });

    runtime.replyQueue.add('plain reply');
    runtime.replyQueue.add('mention reply');

    const mentions = await runtime['drainQueuedReplies'](session);

    expect(steer).toHaveBeenCalledTimes(2);
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({
      role: 'custom',
      customType: 'mention_content',
      content: 'FILE_CONTENT',
      display: false,
    });
  });
});

describe('Runtime reply queue on settle', () => {
  const fakeEvent = (session: AgentSession) => session as unknown as Parameters<Runtime['handleSessionEvent']>[1];

  it('keeps queued replies when the run ended with an API error', () => {
    const runtime = new Runtime(makeFakeWebview());
    runtime.replyQueue.add('Survives');
    runtime['session'] = makeFakeSession(vi.fn());

    runtime['handleSessionEvent'](
      {
        type: 'agent_end',
        messages: [{ role: 'assistant', stopReason: 'error', errorMessage: 'boom' } as never],
        willRetry: false,
      },
      fakeEvent(runtime['session']),
    );

    expect(runtime.replyQueue.all().map((m) => m.text)).toEqual(['Survives']);
  });

  it('clears queued replies when the run settles without an error', () => {
    const runtime = new Runtime(makeFakeWebview());
    runtime.replyQueue.add('Cleared');
    runtime['session'] = makeFakeSession(vi.fn());

    runtime['handleSessionEvent']({ type: 'agent_end', messages: [], willRetry: false }, fakeEvent(runtime['session']));
    runtime['handleSessionEvent']({ type: 'agent_settled' }, fakeEvent(runtime['session']));

    expect(runtime.replyQueue.all()).toEqual([]);
  });

  it('drains queued replies into a new turn when the run settles with queued replies', () => {
    const runtime = new Runtime(makeFakeWebview());
    runtime.replyQueue.add('Keep going');

    const session = { ...makeFakeSession(vi.fn()), sessionFile: '/tmp/task.json' } as unknown as AgentSession;
    runtime['session'] = session;

    const continueTask = vi.spyOn(runtime, 'continueTask').mockResolvedValue(undefined);

    runtime['handleSessionEvent']({ type: 'agent_settled' }, fakeEvent(session));

    expect(continueTask).toHaveBeenCalledWith('/tmp/task.json');
    expect(runtime.replyQueue.all().map((m) => m.text)).toEqual(['Keep going']);
  });

  it('keeps queued replies queued while turns keep ending before the settle', () => {
    const runtime = new Runtime(makeFakeWebview());
    runtime.replyQueue.add('Deferred');
    const session = { ...makeFakeSession(vi.fn()), sessionFile: '/tmp/task.json' } as unknown as AgentSession;
    runtime['session'] = session;

    const continueTask = vi.spyOn(runtime, 'continueTask').mockResolvedValue(undefined);

    runtime['handleSessionEvent']({ type: 'agent_end', messages: [], willRetry: false }, fakeEvent(session));

    expect(continueTask).not.toHaveBeenCalled();
    expect(runtime.replyQueue.all().map((m) => m.text)).toEqual(['Deferred']);
  });
});

describe('Runtime cancellation persistence', () => {
  it('does not persist an assistant message aborted by a task cancel', () => {
    const appendMessage = vi.fn(() => 'persisted-id');
    const session = makeFakeSession(vi.fn(), appendMessage);
    const runtime = new Runtime(makeFakeWebview());

    runtime['bindSessionHooks'](session);

    // After cancelTask, Runtime.session is null.
    runtime['session'] = null;
    session.sessionManager.appendMessage!({
      role: 'assistant',
      stopReason: 'aborted',
    } as never);

    // The wrapper short-circuits and never calls the real appendMessage.
    expect(appendMessage).toHaveBeenCalledTimes(0);
  });

  it('persists non-aborted messages through the real appendMessage', () => {
    const appendMessage = vi.fn(() => 'persisted-id');
    const session = makeFakeSession(vi.fn(), appendMessage);
    const runtime = new Runtime(makeFakeWebview());

    runtime['bindSessionHooks'](session);

    session.sessionManager.appendMessage!({ role: 'user', content: 'hi' } as never);

    expect(appendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('Runtime cancel during init', () => {
  it('does not prompt and settles the webview when cancelled before the session exists', async () => {
    const webview = makeFakeWebview();
    const runtime = new Runtime(webview);
    const gate = deferred<{ session: AgentSession; services: unknown }>();
    mocks.createSession.mockReturnValue(gate.promise);
    const session = makeStartableSession();

    void runtime.startTask('hello');
    // Let startTask reach the session creation await.
    await flush();
    expect(mocks.createSession).toHaveBeenCalledTimes(1);

    await runtime.cancelTask();

    gate.resolve({ session, services: SERVICES });
    await flush();

    expect(session.prompt).not.toHaveBeenCalled();
    expect(session.dispose).toHaveBeenCalledTimes(1);
    const messages = (webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(messages.filter((msg) => msg.type === 'agent_settled')).toHaveLength(1);
  });

  it('discards the fresh session and settles when cancelled after creation but before prompt', async () => {
    const webview = makeFakeWebview();
    const runtime = new Runtime(webview);
    const envGate = deferred<string>();
    const session = makeStartableSession();
    mocks.createSession.mockResolvedValue({ session, services: SERVICES });
    mocks.getEnvironmentDetails.mockReturnValue(envGate.promise);

    void runtime.startTask('hello');
    await flush();
    expect(mocks.getEnvironmentDetails).toHaveBeenCalledTimes(1);

    await runtime.cancelTask();

    envGate.resolve('');
    await flush();

    expect(session.prompt).not.toHaveBeenCalled();
    // Disposed once by cancelTask; the stale resume must not dispose again.
    expect(session.dispose).toHaveBeenCalledTimes(1);
    expect(session.abort).toHaveBeenCalledTimes(1);
    const messages = (webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(messages.filter((msg) => msg.type === 'agent_settled')).toHaveLength(1);
  });

  it('does not settle the webview when a real run is already streaming', async () => {
    const webview = makeFakeWebview();
    const runtime = new Runtime(webview);
    const session = makeStartableSession() as AgentSession & {
      prompt: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
      isStreaming: boolean;
    };
    session.isStreaming = true;
    runtime['session'] = session;

    await runtime.cancelTask();

    const messages = (webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(messages.some((msg) => msg.type === 'agent_settled')).toBe(false);
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it('drops a continuation when cancelled during its preparation', async () => {
    const webview = makeFakeWebview();
    const runtime = new Runtime(webview);
    const envGate = deferred<string>();
    const session = makeStartableSession();
    mocks.createSession.mockResolvedValue({ session, services: SERVICES });
    mocks.getEnvironmentDetails.mockReturnValue(envGate.promise);

    void runtime.continueTask('/tmp/task.json');
    await flush();
    expect(mocks.getEnvironmentDetails).toHaveBeenCalledTimes(1);

    await runtime.cancelTask();

    envGate.resolve('');
    await flush();

    expect(session.sendCustomMessage).not.toHaveBeenCalled();
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it('prompts normally when not cancelled', async () => {
    const webview = makeFakeWebview();
    const runtime = new Runtime(webview);
    const session = makeStartableSession();
    mocks.createSession.mockResolvedValue({ session, services: SERVICES });

    await runtime.startTask('hello');
    await flush();

    expect(session.prompt).toHaveBeenCalledTimes(1);
    const messages = (webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    expect(messages.some((msg) => msg.type === 'agent_settled')).toBe(false);
  });

  it('sends text attachments as hidden messages and keeps them out of the prompt', async () => {
    const webview = makeFakeWebview();
    const runtime = new Runtime(webview);
    const session = makeStartableSession();
    mocks.createSession.mockResolvedValue({ session, services: SERVICES });

    await runtime.startTask('hi', [{ kind: 'text', content: 'SECRET', language: 'ts' }]);
    await flush();

    expect(session.prompt).toHaveBeenCalledTimes(1);
    expect(session.prompt.mock.calls[0][0]).toBe('hi');
    expect(mocks.sendHiddenContent).toHaveBeenCalledWith(session, 'text_attachment', '``` ts\nSECRET\n```', {
      deliverAs: 'nextTurn',
    });
  });
});

// Compaction shares the harness above; these cover the manual compact() round
// trip and the automatic resume-on-settle contract.
const SESSION_STATS = () => ({
  tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 },
  cost: 0.5,
  contextUsage: { tokens: 30, contextWindow: 1000 },
});

describe('Runtime compaction', () => {
  function posted(webview: Webview): Array<{ type: string }> {
    return (webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as { type: string });
  }

  function makeCompactSession(impl: () => Promise<unknown>): AgentSession & { compact: ReturnType<typeof vi.fn> } {
    return {
      ...makeStartableSession(),
      compact: vi.fn(impl),
      sessionManager: { appendMessage: vi.fn(() => 'persisted-id'), buildContextEntries: () => [] },
      getSessionStats: SESSION_STATS,
    } as unknown as AgentSession & { compact: ReturnType<typeof vi.fn> };
  }

  it('returns the post-compaction estimate and brackets the run with start and end messages', async () => {
    const webview = makeFakeWebview();
    const session = makeCompactSession(async () => ({ estimatedTokensAfter: 123 }));
    mocks.createSession.mockResolvedValue({ session, services: SERVICES });
    mocks.loadSessionTranscript.mockReturnValue({ messages: [{ id: 'm1', sender: 'user', text: 'hi', ts: 1 }], stats: { contextTokens: 999 } });
    const runtime = new Runtime(webview);

    const result = await runtime.compact(undefined);

    expect(result).toEqual({ messages: [{ id: 'm1', sender: 'user', text: 'hi', ts: 1 }], stats: { contextTokens: 123 } });
    expect(session.compact).toHaveBeenCalledTimes(1);
    const types = posted(webview).map((message) => message.type);
    expect(types.filter((type) => type === 'compaction_start')).toHaveLength(1);
    expect(types.filter((type) => type === 'compaction_end')).toHaveLength(1);
  });

  it('swallows an aborted compaction instead of posting an error bubble', async () => {
    const webview = makeFakeWebview();
    const session = makeCompactSession(async () => {
      throw Object.assign(new Error('Compaction cancelled'), { name: 'AbortError' });
    });
    mocks.createSession.mockResolvedValue({ session, services: SERVICES });
    const runtime = new Runtime(webview);

    const result = await runtime.compact(undefined);

    expect(result).toBeNull();
    expect(posted(webview).some((message) => message.type === 'agent_error')).toBe(false);
    expect(posted(webview).filter((message) => message.type === 'compaction_end')).toHaveLength(1);
  });

  it('surfaces real compaction failures and still posts the end banner', async () => {
    const webview = makeFakeWebview();
    const session = makeCompactSession(async () => {
      throw new Error('disk full');
    });
    mocks.createSession.mockResolvedValue({ session, services: SERVICES });
    const runtime = new Runtime(webview);

    const result = await runtime.compact(undefined);

    expect(result).toBeNull();
    expect(posted(webview)).toContainEqual({ type: 'agent_error', payload: { message: expect.stringContaining('disk full') } });
    expect(posted(webview).filter((message) => message.type === 'compaction_end')).toHaveLength(1);
  });
});

describe('Runtime compaction before turns', () => {
  function makeThresholdSession(tokens: number): AgentSession & { compact: ReturnType<typeof vi.fn> } {
    return {
      ...makeStartableSession(),
      getContextUsage: () => ({ tokens, contextWindow: 1000, percent: Math.round((tokens / 1000) * 100) }),
      compact: vi.fn(async () => ({ estimatedTokensAfter: 120 })),
      sessionManager: { ...makeStartableSession().sessionManager, buildContextEntries: () => [] },
    } as unknown as AgentSession & { compact: ReturnType<typeof vi.fn> };
  }

  function postedTypes(webview: Webview): string[] {
    return (webview.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((call) => (call[0] as { type: string }).type);
  }

  it('compacts before startTask when the context is above the threshold', async () => {
    const webview = makeFakeWebview();
    const session = makeThresholdSession(950);
    mocks.createSession.mockResolvedValue({ session, services: SERVICES });
    const runtime = new Runtime(webview);

    await runtime.startTask('hello');
    await flush();

    expect(session.compact).toHaveBeenCalledTimes(1);
    expect(session.prompt).toHaveBeenCalledTimes(1);

    const types = postedTypes(webview);
    expect(types.filter((type) => type === 'compaction_start')).toHaveLength(1);
    expect(types.filter((type) => type === 'compaction_end')).toHaveLength(1);
  });

  it('does not compact before startTask when the context is below the threshold', async () => {
    const webview = makeFakeWebview();
    const session = makeThresholdSession(100);
    mocks.createSession.mockResolvedValue({ session, services: SERVICES });
    const runtime = new Runtime(webview);

    await runtime.startTask('hello');
    await flush();

    expect(session.compact).not.toHaveBeenCalled();
    expect(session.prompt).toHaveBeenCalledTimes(1);
  });

  it('compacts before continueTask when the context is above the threshold', async () => {
    const webview = makeFakeWebview();
    const session = makeThresholdSession(950);
    mocks.createSession.mockResolvedValue({ session, services: SERVICES });
    const runtime = new Runtime(webview);
    runtime['session'] = session;

    await runtime.continueTask(session.sessionFile ?? '/tmp/task.json');
    await flush();

    expect(session.compact).toHaveBeenCalledTimes(1);
    expect(mocks.getEnvironmentDetails).toHaveBeenCalledTimes(1);
    expect(mocks.sendHiddenContent).toHaveBeenCalledWith(session, 'environment_details', '', { triggerTurn: true });
  });

  it('compacts before resuming an errored turn that is already past the threshold', async () => {
    const webview = makeFakeWebview();
    const session = makeThresholdSession(950);
    mocks.createSession.mockResolvedValue({ session, services: SERVICES });
    const runtime = new Runtime(webview);
    runtime['session'] = session;

    runtime['handleSessionEvent'](
      {
        type: 'agent_end',
        messages: [{ role: 'assistant', stopReason: 'error', errorMessage: 'rate limited' } as never],
        willRetry: false,
      } as never,
      session,
    );
    await flush();

    expect(session.compact).toHaveBeenCalledTimes(1);
    expect(mocks.getEnvironmentDetails).toHaveBeenCalledTimes(1);
    expect(mocks.sendHiddenContent).toHaveBeenCalledWith(session, 'environment_details', '', { triggerTurn: true });
  });
});

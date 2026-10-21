import { describe, expect, it } from 'vitest';

import { abortToolCall, createToolAbort } from '@pi-code/extension/structures/agent-runtime/brokers/tool-call';

describe('tool call aborts', () => {
  it('stops one call and leaves the run alone', () => {
    const run = new AbortController();
    const abort = createToolAbort('call-1', run.signal);

    expect(abort.signal.aborted).toBe(false);
    expect(abortToolCall('call-1')).toBe(true);
    expect(abort.signal.aborted).toBe(true);
    expect(abort.cancelled).toBe(true);
    expect(run.signal.aborted).toBe(false);

    abort.dispose();
  });

  it('reports no cancellation when the run is torn down instead', () => {
    const run = new AbortController();
    const abort = createToolAbort('call-2', run.signal);

    run.abort();

    expect(abort.signal.aborted).toBe(true);
    expect(abort.cancelled).toBe(false);

    abort.dispose();
  });

  it('starts out aborted when the run was already torn down', () => {
    const run = new AbortController();
    run.abort();

    const abort = createToolAbort('call-3', run.signal);

    expect(abort.signal.aborted).toBe(true);
    expect(abort.cancelled).toBe(false);

    abort.dispose();
  });

  it('ignores a call that is not running', () => {
    expect(abortToolCall('missing')).toBe(false);
  });

  it('releases the call once the tool is done with it', () => {
    const abort = createToolAbort('call-4');
    abort.dispose();

    expect(abortToolCall('call-4')).toBe(false);
  });
});

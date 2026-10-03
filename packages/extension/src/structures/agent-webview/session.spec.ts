import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getInitData } from '@pi-code/extension/structures/agent-webview/session';

import type { Api, Model } from '@earendil-works/pi-ai';
import type { AgentSessionServices, ModelRuntime } from '@earendil-works/pi-coding-agent';

vi.mock('@pi-code/extension/core/settings', () => ({
  getDefaultModelSelection: vi.fn(async () => ({ id: 'zen-model', provider: 'zen' })),
  getSettingsManager: () => ({ getDefaultThinkingLevel: () => undefined }),
  readAppSettings: () => ({}),
}));

vi.mock('@pi-code/extension/structures/chat-command/command', () => ({ collectCommands: () => [] }));

const model = (provider: string, id: string): Model<Api> =>
  ({ provider, id, name: `${provider} ${id}`, contextWindow: 200_000, input: ['text'] }) as unknown as Model<Api>;

// The snapshot stands in for the catalog the services restore from disk; the
// availability pass is the part the first list must not wait on.
function makeRuntime(cached: Model<Api>[], available: Model<Api>[], all: Model<Api>[] = [...cached, ...available]): ModelRuntime {
  return {
    getAvailableSnapshot: () => cached,
    getModels: () => all,
    getAvailable: vi.fn(async () => available),
  } as unknown as ModelRuntime;
}

const makeServices = (modelRuntime: ModelRuntime): AgentSessionServices => ({ modelRuntime, resourceLoader: {} }) as unknown as AgentSessionServices;

describe('getInitData model list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists the restored snapshot without waiting on the availability pass', async () => {
    // An extension provider's models are in the cache but its auth check has
    // not settled yet, so a list built from getAvailable() would drop them.
    const zen = model('zen', 'space-bunny-free');
    const anthropic = model('anthropic', 'claude-opus-4-8');
    const runtime = makeRuntime([anthropic, zen], [anthropic]);

    const data = await getInitData('C:/workspace', makeServices(runtime));

    expect(runtime.getAvailable).not.toHaveBeenCalled();
    expect(data.models.map((entry) => `${entry.provider}/${entry.id}`)).toEqual(['anthropic/claude-opus-4-8', 'zen/space-bunny-free']);
    // The persisted "zen-model" is not in this catalog, so the first cached
    // model stands in for it.
    expect(data.default_model).toMatchObject({ id: 'claude-opus-4-8', provider: 'anthropic' });
  });

  it('falls back to the full catalog when nothing is cached yet', async () => {
    const cached = model('openai', 'gpt-5');
    const runtime = makeRuntime([], [cached]);

    const data = await getInitData('C:/workspace', makeServices(runtime));

    expect(data.models.map((entry) => `${entry.provider}/${entry.id}`)).toEqual(['openai/gpt-5']);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDefaultModelSelection } from '@pi-code/extension/core/settings';
import { getInitData, refreshModelCatalog } from '@pi-code/extension/structures/agent-webview/session';
import { logger } from '@pi-code/shared/core/logger';

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
    // The persisted "zen-model" is not in this catalog, so the first model of
    // the provider the user chose stands in, not the first model overall.
    expect(data.default_model).toMatchObject({ id: 'space-bunny-free', provider: 'zen' });
  });

  it('falls back to the full catalog when nothing is cached yet', async () => {
    const cached = model('openai', 'gpt-5');
    const runtime = makeRuntime([], [cached]);

    const data = await getInitData('C:/workspace', makeServices(runtime));

    expect(data.models.map((entry) => `${entry.provider}/${entry.id}`)).toEqual(['openai/gpt-5']);
  });

  it('names the selection it could not resolve and keeps its provider', async () => {
    // The catalog carries the provider but not the persisted model, so the
    // footer must stay on that provider and report the stale selection.
    const kilo = model('ext-kilo', 'cohere/north-mini-code:free');
    const anthropic = model('anthropic', 'claude-opus-4-8');
    const runtime = makeRuntime([kilo, anthropic], [kilo, anthropic]);
    vi.mocked(getDefaultModelSelection).mockResolvedValue({ id: 'stepfun/step-3.7-flash:free', provider: 'ext-kilo' });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const data = await getInitData('C:/workspace', makeServices(runtime));

    expect(data.default_model).toMatchObject({ id: 'cohere/north-mini-code:free', provider: 'ext-kilo' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"ext-kilo/stepfun/step-3.7-flash:free" is not in the catalog'));
  });

  it('never resolves a model id to a provider the settings did not name', async () => {
    const shared = model('ext-kilo', 'shared-id');
    const zen = model('ext-zen', 'space-bunny-free');
    const runtime = makeRuntime([shared, zen], [shared, zen]);
    vi.mocked(getDefaultModelSelection).mockResolvedValue({ id: 'shared-id', provider: 'ext-zen' });

    const data = await getInitData('C:/workspace', makeServices(runtime));

    expect(data.default_model).toMatchObject({ id: 'space-bunny-free', provider: 'ext-zen' });
  });

  it('falls back to the first catalog entry when the persisted provider is unknown', async () => {
    const anthropic = model('anthropic', 'claude-opus-4-8');
    const runtime = makeRuntime([anthropic], [anthropic]);
    // "kilo" is not a provider id; the extension registers as "ext-kilo".
    vi.mocked(getDefaultModelSelection).mockResolvedValue({ id: 'stepfun/step-3.7-flash:free', provider: 'kilo' });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const data = await getInitData('C:/workspace', makeServices(runtime));

    expect(data.default_model).toMatchObject({ id: 'claude-opus-4-8', provider: 'anthropic' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"kilo/stepfun/step-3.7-flash:free" is not in the catalog'));
  });
});

describe('refreshModelCatalog', () => {
  it('reports the provider whose catalog refresh failed', async () => {
    const runtime = {
      refresh: vi.fn(async () => ({
        aborted: false,
        errors: new Map([['ext-kilo', new Error('Kilo models request failed: 503')]]),
      })),
      getAvailable: vi.fn(async () => [model('ext-zen', 'big-pickle')]),
    } as unknown as ModelRuntime;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const models = await refreshModelCatalog(runtime);

    expect(models?.map((entry) => `${entry.provider}/${entry.id}`)).toEqual(['ext-zen/big-pickle']);
    expect(warn).toHaveBeenCalledWith('Model catalog refresh failed for provider "ext-kilo": Kilo models request failed: 503');
  });
});

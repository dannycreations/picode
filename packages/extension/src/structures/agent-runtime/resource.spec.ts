import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentResources, invalidateAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';

const mocks = vi.hoisted(() => ({
  readAppSettings: vi.fn(),
  isProjectTrusted: vi.fn(() => false),
}));

vi.mock('@pi-code/extension/core/settings', () => ({
  readAppSettings: mocks.readAppSettings,
  getSettingsManager: () => ({ setProjectTrusted: vi.fn() }),
}));

vi.mock('@pi-code/extension/utilities/vscode', () => ({
  isProjectTrusted: mocks.isProjectTrusted,
}));

// Keep discovery off the developer's machine-global agent directory so test
// outcomes depend only on this file's fixtures.
vi.mock('@pi-code/extension/structures/agent-runtime/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pi-code/extension/structures/agent-runtime/context')>()),
  discoverContext: vi.fn(async () => ({ agentRules: [], appendSystemPrompt: [] })),
}));

// Vitest 4 cannot intercept natively loaded node_modules, so instead of
// mocking @earendil-works/pi-coding-agent these tests inject a stub factory;
// every call yields a distinct service object, which keeps the identity
// assertions meaningful.
type CreateServices = Parameters<typeof createAgentResources>[1];
let creations = 0;

function makeStubFactory(): CreateServices {
  return vi.fn(async () => {
    creations += 1;
    return { modelRuntime: {}, settingsManager: {}, resourceLoader: { creation: creations }, diagnostics: [] };
  }) as unknown as CreateServices;
}

const BASE_SETTINGS = { enableAgentRules: true, enableSkillDiscovery: true };

afterEach(() => {
  invalidateAgentResources();
  mocks.readAppSettings.mockReset();
  mocks.isProjectTrusted.mockReturnValue(false);
});

describe('createAgentResources cache', () => {
  it('returns the cached services when the loader-relevant config is unchanged', async () => {
    mocks.readAppSettings.mockReturnValue({ ...BASE_SETTINGS });
    const factory = makeStubFactory();

    const first = await createAgentResources('/project-a', factory);
    const second = await createAgentResources('/project-a', factory);

    expect(second.resourceLoader).toBe(first.resourceLoader);
  });

  it('reuses the cached services without recreating on a cache hit', async () => {
    mocks.readAppSettings.mockReturnValue({ ...BASE_SETTINGS });
    const factory = makeStubFactory();

    const first = await createAgentResources('/project-b', factory);
    const second = await createAgentResources('/project-b', factory);

    expect(second).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('recreates the services when a loader-relevant setting flips', async () => {
    mocks.readAppSettings.mockReturnValue({ ...BASE_SETTINGS });
    const factory = makeStubFactory();
    const first = await createAgentResources('/project-c', factory);

    mocks.readAppSettings.mockReturnValue({ ...BASE_SETTINGS, enableSkillDiscovery: false });
    const second = await createAgentResources('/project-c', factory);

    expect(second.resourceLoader).not.toBe(first.resourceLoader);
  });

  it('recreates the services when workspace trust changes', async () => {
    mocks.readAppSettings.mockReturnValue({ ...BASE_SETTINGS });
    const factory = makeStubFactory();
    const first = await createAgentResources('/project-d', factory);

    mocks.isProjectTrusted.mockReturnValue(true);
    const second = await createAgentResources('/project-d', factory);

    expect(second.resourceLoader).not.toBe(first.resourceLoader);
  });
});

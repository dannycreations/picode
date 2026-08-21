import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';

const mocks = vi.hoisted(() => ({
  readAppSettings: vi.fn(),
  isProjectTrusted: vi.fn(() => false),
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSessionServices: async () => ({
    modelRuntime: {},
    settingsManager: {},
    resourceLoader: { __loader: Math.random() },
    diagnostics: [],
  }),
}));

vi.mock('@pi-code/extension/core/settings', () => ({
  readAppSettings: mocks.readAppSettings,
  getSettingsManager: () => ({ setProjectTrusted: vi.fn() }),
}));

vi.mock('@pi-code/extension/utilities/vscode', () => ({
  isProjectTrusted: mocks.isProjectTrusted,
}));

const BASE_SETTINGS = { enableAgentRules: true, enableSkillDiscovery: true };

afterEach(() => {
  mocks.readAppSettings.mockReset();
  mocks.isProjectTrusted.mockReturnValue(false);
});

describe('createAgentResources cache', () => {
  it('returns the cached services when the loader-relevant config is unchanged', async () => {
    mocks.readAppSettings.mockReturnValue({ ...BASE_SETTINGS });

    const first = await createAgentResources('/project-a');
    const second = await createAgentResources('/project-a');

    expect(second.resourceLoader).toBe(first.resourceLoader);
  });

  it('reuses the cached services without recreating on a cache hit', async () => {
    mocks.readAppSettings.mockReturnValue({ ...BASE_SETTINGS });

    const first = await createAgentResources('/project-b');
    const second = await createAgentResources('/project-b');

    expect(second).toBe(first);
  });

  it('recreates the services when a loader-relevant setting flips', async () => {
    mocks.readAppSettings.mockReturnValue({ ...BASE_SETTINGS });
    const first = await createAgentResources('/project-c');

    mocks.readAppSettings.mockReturnValue({ ...BASE_SETTINGS, enableSkillDiscovery: false });
    const second = await createAgentResources('/project-c');

    expect(second.resourceLoader).not.toBe(first.resourceLoader);
  });

  it('recreates the services when workspace trust changes', async () => {
    mocks.readAppSettings.mockReturnValue({ ...BASE_SETTINGS });
    const first = await createAgentResources('/project-d');

    mocks.isProjectTrusted.mockReturnValue(true);
    const second = await createAgentResources('/project-d');

    expect(second.resourceLoader).not.toBe(first.resourceLoader);
  });
});

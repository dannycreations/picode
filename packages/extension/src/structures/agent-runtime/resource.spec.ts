import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';

const mocks = vi.hoisted(() => ({
  settingsLoad: vi.fn(),
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
  SettingsService: {
    getInstance: vi.fn(() => ({
      load: mocks.settingsLoad,
      getSettingsManager: () => ({ setProjectTrusted: vi.fn() }),
    })),
  },
}));

vi.mock('@pi-code/extension/utilities/vscode', () => ({
  isProjectTrusted: mocks.isProjectTrusted,
}));

const BASE_SETTINGS = { enableAgentRules: true, enableSkillDiscovery: true };

afterEach(() => {
  mocks.settingsLoad.mockReset();
  mocks.isProjectTrusted.mockReturnValue(false);
});

describe('createAgentResources cache', () => {
  it('returns the cached services when the loader-relevant config is unchanged', async () => {
    mocks.settingsLoad.mockResolvedValue({ ...BASE_SETTINGS });

    const first = await createAgentResources('/project-a');
    const second = await createAgentResources('/project-a');

    expect(second.services.resourceLoader).toBe(first.services.resourceLoader);
  });

  it('reuses the cached services without recreating on a cache hit', async () => {
    mocks.settingsLoad.mockResolvedValue({ ...BASE_SETTINGS });

    const first = await createAgentResources('/project-b');
    const second = await createAgentResources('/project-b');

    expect(second.services).toBe(first.services);
  });

  it('recreates the services when a loader-relevant setting flips', async () => {
    mocks.settingsLoad.mockResolvedValue({ ...BASE_SETTINGS });
    const first = await createAgentResources('/project-c');

    mocks.settingsLoad.mockResolvedValue({ ...BASE_SETTINGS, enableSkillDiscovery: false });
    const second = await createAgentResources('/project-c');

    expect(second.services.resourceLoader).not.toBe(first.services.resourceLoader);
  });
});

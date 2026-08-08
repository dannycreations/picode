import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentResources } from '@pi-code/extension/structures/agent-runtime/resource';

const mocks = vi.hoisted(() => ({
  settingsLoad: vi.fn(),
  isProjectTrusted: vi.fn(() => false),
}));

vi.mock('@earendil-works/pi-coding-agent', () => {
  class FakeResourceLoader {
    public reloadCalls = 0;
    public async reload(): Promise<void> {
      this.reloadCalls += 1;
    }
  }
  return {
    DefaultResourceLoader: FakeResourceLoader,
    SettingsManager: { create: () => ({}) },
    getAgentDir: () => '/agent-dir',
  };
});

vi.mock('@pi-code/extension/core/settings', () => ({
  SettingsService: {
    getInstance: vi.fn(() => ({ load: mocks.settingsLoad })),
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
  it('returns the cached loader when the loader-relevant config is unchanged', async () => {
    mocks.settingsLoad.mockResolvedValue({ ...BASE_SETTINGS });

    const first = await createAgentResources('/project-a');
    const second = await createAgentResources('/project-a');

    expect(second.resourceLoader).toBe(first.resourceLoader);
  });

  it('reloads the cached loader on each cache hit', async () => {
    mocks.settingsLoad.mockResolvedValue({ ...BASE_SETTINGS });

    const first = await createAgentResources('/project-b');
    const second = await createAgentResources('/project-b');

    expect(second.resourceLoader).toBe(first.resourceLoader);
    expect((second.resourceLoader as unknown as { reloadCalls: number }).reloadCalls).toBe(2);
  });

  it('recreates the loader when a loader-relevant setting flips', async () => {
    mocks.settingsLoad.mockResolvedValue({ ...BASE_SETTINGS });
    const first = await createAgentResources('/project-c');

    mocks.settingsLoad.mockResolvedValue({ ...BASE_SETTINGS, enableSkillDiscovery: false });
    const second = await createAgentResources('/project-c');

    expect(second.resourceLoader).not.toBe(first.resourceLoader);
  });
});

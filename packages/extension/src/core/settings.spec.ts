import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from '@earendil-works/pi-coding-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  invalidateAppSettings,
  readCommitMessageModelSelection,
  readCommitMessageThinkingLevel,
  readDelegationTaskModelSelection,
  readDelegationTaskThinkingLevel,
  readOutputLimits,
} from '@pi-code/extension/core/settings';
import { getSettingSpec, SETTING_KEYS } from '@pi-code/shared/core/settings';
import manifest from '../../package.json' with { type: 'json' };
import { buildManifestSettings } from '../../scripts/settings.ts';

const { configValues } = vi.hoisted(() => ({ configValues: {} as Record<string, unknown> }));

vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: { getConfiguration: () => ({ get: (key: string) => configValues[key] }) },
}));

describe('readOutputLimits', () => {
  beforeEach(() => {
    for (const key of Object.keys(configValues)) delete configValues[key];
    invalidateAppSettings();
  });

  it('converts the kilobyte setting into a byte budget', () => {
    Object.assign(configValues, { maxToolOutputLines: 1500, maxToolOutputSizeKb: 32 });
    expect(readOutputLimits()).toEqual({ maxLines: 1500, maxBytes: 32 * 1024 });
  });

  it('matches the pi defaults out of the box', () => {
    // An unset key falls back to the schema default declared in package.json.
    expect(readOutputLimits()).toEqual({ maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  });

  it('re-reads the budget after the settings cache is invalidated', () => {
    Object.assign(configValues, { maxToolOutputSizeKb: 8 });
    expect(readOutputLimits().maxBytes).toBe(8 * 1024);

    Object.assign(configValues, { maxToolOutputSizeKb: 16 });
    invalidateAppSettings();
    expect(readOutputLimits().maxBytes).toBe(16 * 1024);
  });
});

describe('model and thinking level settings', () => {
  beforeEach(() => {
    for (const key of Object.keys(configValues)) delete configValues[key];
    invalidateAppSettings();
  });

  it('splits a configured model into provider and id', () => {
    Object.assign(configValues, { delegationTaskModel: 'openrouter/anthropic/claude-sonnet-4' });

    expect(readDelegationTaskModelSelection()).toEqual({ provider: 'openrouter', id: 'anthropic/claude-sonnet-4' });
  });

  it('reports nothing for an unset or unusable value', () => {
    Object.assign(configValues, { delegationTaskModel: 'anthropic', commitMessageThinkingLevel: 'maximum' });

    expect(readDelegationTaskModelSelection()).toBeUndefined();
    expect(readCommitMessageThinkingLevel()).toBeUndefined();
    expect(readCommitMessageModelSelection()).toBeUndefined();
    expect(readDelegationTaskThinkingLevel()).toBeUndefined();
  });

  it('keeps a stored thinking level the agent understands', () => {
    Object.assign(configValues, { commitMessageThinkingLevel: 'high', delegationTaskThinkingLevel: 'off' });

    expect(readCommitMessageThinkingLevel()).toBe('high');
    expect(readDelegationTaskThinkingLevel()).toBe('off');
  });
});

describe('contributed configuration', () => {
  it('matches the shared settings schema', () => {
    // Regenerate with "pnpm --filter pi-code run check:settings" when this fails.
    const expected = buildManifestSettings(manifest.name);
    expect(manifest.contributes.configuration.properties).toEqual(expected.properties);
  });

  it('declares exactly the schema keys', () => {
    const declared = Object.keys(manifest.contributes.configuration.properties).map((key) => key.slice(manifest.name.length + 1));
    expect(declared).toEqual([...SETTING_KEYS]);
  });

  it('restricts every trust sensitive setting in untrusted workspaces', () => {
    const { restricted } = buildManifestSettings(manifest.name);
    expect(manifest.capabilities.untrustedWorkspaces.restrictedConfigurations).toEqual([...restricted]);
    expect(restricted.length).toBeGreaterThan(0);
  });
});

describe('schema defaults', () => {
  it('keeps every default inside its own bounds', () => {
    for (const key of SETTING_KEYS) {
      const spec = getSettingSpec(key);
      if (spec.type !== 'number') continue;
      expect(spec.default, key).toBeGreaterThanOrEqual(spec.minimum);
      expect(spec.default, key).toBeLessThanOrEqual(spec.maximum);
    }
  });
});

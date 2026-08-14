import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, SETTING_KEYS, SETTINGS_SCHEMA } from '@pi-code/shared/core/settings';
import manifest from '../../package.json' with { type: 'json' };
import { buildManifestSettings } from '../../scripts/settings.ts';

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
      const spec = SETTINGS_SCHEMA[key];
      if (spec.type !== 'number') continue;
      expect(spec.default, key).toBeGreaterThanOrEqual(spec.minimum);
      expect(spec.default, key).toBeLessThanOrEqual(spec.maximum);
    }
  });

  it('mirrors the agent tool output limits', () => {
    expect(DEFAULT_SETTINGS.maxToolOutputLines).toBe(DEFAULT_MAX_LINES);
    expect(DEFAULT_SETTINGS.maxToolOutputSizeKb).toBe(DEFAULT_MAX_BYTES / 1024);
  });
});

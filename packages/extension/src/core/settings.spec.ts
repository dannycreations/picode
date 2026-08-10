import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, SETTING_KEYS } from '@pi-code/extension/core/settings';
import manifest from '../../package.json' with { type: 'json' };

const contributed = manifest.contributes.configuration.properties as Record<string, { type: string; default: unknown }>;

describe('contributed configuration', () => {
  it('declares exactly the AppSettings keys', () => {
    const declared = Object.keys(contributed).map((key) => key.slice(manifest.name.length + 1));
    expect(declared.sort()).toEqual([...SETTING_KEYS].sort());
  });

  it('mirrors the in-code defaults', () => {
    for (const key of SETTING_KEYS) {
      expect(contributed[`${manifest.name}.${key}`].default, key).toEqual(DEFAULT_SETTINGS[key]);
    }
  });

  it('declares a JSON type matching each default', () => {
    for (const key of SETTING_KEYS) {
      const fallback = DEFAULT_SETTINGS[key];
      const expected = Array.isArray(fallback) ? 'array' : typeof fallback;
      expect(contributed[`${manifest.name}.${key}`].type, key).toBe(expected);
    }
  });
});

import { describe, expect, it } from 'vitest';

import { coerceSetting, coerceSettings, getSettingSpec, SETTING_KEYS } from '@pi-code/shared/core/settings';

import type { AppSettings } from '@pi-code/shared/core/settings';

// Materializes defaults through coerceSetting, the same path production reads use.
function defaultSettings(): AppSettings {
  return Object.fromEntries(SETTING_KEYS.map((key) => [key, coerceSetting(key, undefined)])) as AppSettings;
}

const DEFAULT_SETTINGS = defaultSettings();

describe('settings schema', () => {
  it('derives keys and defaults from the schema', () => {
    for (const key of SETTING_KEYS) {
      expect(DEFAULT_SETTINGS[key], key).toEqual(getSettingSpec(key).default);
    }
  });

  it('hands out fresh array defaults', () => {
    const first = defaultSettings();
    const second = defaultSettings();
    expect(first.allowedReadPaths).not.toBe(second.allowedReadPaths);
    expect(first.allowedReadPaths).toEqual([]);
  });
});

describe('coerceSetting', () => {
  it('falls back to the default on a type mismatch', () => {
    expect(coerceSetting('autoApproveRead', 'yes')).toBe(false);
    expect(coerceSetting('maxWorkspaceFiles', '100')).toBe(DEFAULT_SETTINGS.maxWorkspaceFiles);
    expect(coerceSetting('maxWorkspaceFiles', Number.NaN)).toBe(DEFAULT_SETTINGS.maxWorkspaceFiles);
    expect(coerceSetting('allowedReadPaths', 'src/**')).toEqual([]);
  });

  it('clamps numbers into the declared bounds', () => {
    expect(coerceSetting('autoCompactContextPercent', 999)).toBe(100);
    expect(coerceSetting('autoCompactContextPercent', -1)).toBe(10);
    expect(coerceSetting('autoCompactContextPercent', 55)).toBe(55);
  });

  it('keeps only string entries in list settings', () => {
    expect(coerceSetting('allowedExecuteCommands', ['npm', 7, null, 'git'])).toEqual(['npm', 'git']);
  });
});

describe('coerceSettings', () => {
  it('drops unknown keys and normalizes the rest', () => {
    expect(coerceSettings({ autoApproveWrite: true, maxGitStatusFiles: 9001, nope: 'gone' })).toEqual({
      autoApproveWrite: true,
      maxGitStatusFiles: 50,
    });
  });
});

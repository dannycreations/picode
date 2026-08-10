import { describe, expect, it } from 'vitest';

import { getSettingSpec, SETTING_KEYS } from '@pi-code/shared/core/settings';
import { getChildFieldKeys, getRootFieldKeys, SETTING_FIELDS, SETTINGS_TABS } from '@pi-code/webview/components/setting/core/fields';

describe('setting fields', () => {
  it('renders every schema key exactly once', () => {
    const rendered = SETTINGS_TABS.flatMap((tab) => getRootFieldKeys(tab.id)).flatMap((key) => [key, ...getChildFieldKeys(key)]);
    expect([...rendered].sort()).toEqual([...SETTING_KEYS].sort());
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it('nests controls under a boolean setting from the same tab', () => {
    for (const key of SETTING_KEYS) {
      const { parent, tab } = SETTING_FIELDS[key];
      if (!parent) continue;
      expect(getSettingSpec(parent).type, key).toBe('boolean');
      expect(SETTING_FIELDS[parent].parent, key).toBeUndefined();
      expect(SETTING_FIELDS[parent].tab, key).toBe(tab);
    }
  });

  it('gives every list setting a placeholder', () => {
    for (const key of SETTING_KEYS) {
      if (getSettingSpec(key).type !== 'string[]') continue;
      const field = SETTING_FIELDS[key];
      expect('placeholder' in field && field.placeholder, key).toBeTruthy();
    }
  });
});

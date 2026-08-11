import { describe, expect, it } from 'vitest';

import { getSettingSpec, SETTING_KEYS } from '@pi-code/shared/core/settings';
import {
  getChildFieldKeys,
  getRootFieldKeys,
  isFieldVisible,
  matchesQuery,
  SETTING_FIELDS,
  SETTINGS_TABS,
} from '@pi-code/webview/components/setting/core/fields';

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

  describe('search query matching', () => {
    it('matches empty query correctly', () => {
      expect(matchesQuery('enableTodoTool', '')).toBe(true);
      expect(isFieldVisible('enableTodoTool', '')).toBe(true);
    });

    it('matches by key name, label, or description', () => {
      // Key name match
      expect(matchesQuery('enableTodoTool', 'todotool')).toBe(true);
      // Label match
      expect(matchesQuery('enableTodoTool', 'Task Planning')).toBe(true);
      // Description match
      expect(matchesQuery('enableTodoTool', 'checklist')).toBe(true);
      // Non-match
      expect(matchesQuery('enableTodoTool', 'somethingelse')).toBe(false);
    });

    it('handles parent-child visibility nesting correctly', () => {
      // autoApproveRead is parent of autoApproveSkillReads, allowedReadPaths, deniedReadPaths
      // Searching for "Allowed Read Paths" should show child, and make parent visible too
      expect(isFieldVisible('autoApproveRead', 'Allowed Read Paths')).toBe(true);

      // If parent matched, children are visible
      expect(isFieldVisible('autoApproveSkillReads', 'Read Files', true)).toBe(true);
    });
  });
});

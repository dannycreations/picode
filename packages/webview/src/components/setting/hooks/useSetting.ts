import { useEffect, useState } from 'react';

import { SETTING_KEYS } from '@pi-code/shared/core/settings';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';

import type { AppSettings, SettingKey } from '@pi-code/shared/core/settings';

export function areSettingsValuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, index) => val === b[index]);
  }
  return a === b;
}

interface UseSettingReturn {
  readonly draftSettings: AppSettings;
  readonly isChangeDetected: boolean;
  readonly handleFieldChange: <K extends SettingKey>(key: K, value: AppSettings[K]) => void;
  readonly handleSave: () => void;
  readonly resetDraft: () => void;
}

export const useSetting = (settings: AppSettings): UseSettingReturn => {
  const [draftSettings, setDraftSettings] = useState<AppSettings>(settings);

  useEffect(() => {
    setDraftSettings(settings);
  }, [settings]);

  const isChangeDetected = SETTING_KEYS.some((key) => !areSettingsValuesEqual(draftSettings[key], settings[key]));

  const handleFieldChange = <K extends SettingKey>(key: K, value: AppSettings[K]): void => {
    setDraftSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = (): void => {
    const updates: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) {
      if (!areSettingsValuesEqual(draftSettings[key], settings[key])) {
        updates[key] = draftSettings[key];
      }
    }

    if (Object.keys(updates).length === 0) return;

    useChatStore.getState().send({ type: 'update_settings', settings: updates as Partial<AppSettings> });
  };

  const resetDraft = (): void => {
    setDraftSettings(settings);
  };

  return {
    draftSettings,
    isChangeDetected,
    handleFieldChange,
    handleSave,
    resetDraft,
  };
};

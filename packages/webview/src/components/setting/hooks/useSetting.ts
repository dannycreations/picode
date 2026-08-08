import { useEffect, useState } from 'react';

import { vscode } from '@pi-code/webview/utilities/vscode';

import type { AppSettings } from '@pi-code/shared/core/settings';

export function areSettingsValuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, index) => val === b[index]);
  }
  return a === b;
}

export interface UseSettingReturn {
  readonly draftSettings: AppSettings;
  readonly isChangeDetected: boolean;
  readonly handleFieldChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  readonly handleSave: () => void;
  readonly resetDraft: () => void;
}

export const useSetting = (settings: AppSettings): UseSettingReturn => {
  const [draftSettings, setDraftSettings] = useState<AppSettings>(settings);

  useEffect(() => {
    setDraftSettings(settings);
  }, [settings]);

  const isChangeDetected = (() => {
    const keys = Object.keys(draftSettings) as Array<keyof AppSettings>;
    return keys.some((key) => !areSettingsValuesEqual(draftSettings[key], settings[key]));
  })();

  const handleFieldChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    setDraftSettings({ ...draftSettings, [key]: value });
  };

  const handleSave = (): void => {
    const updates: Partial<AppSettings> = {};
    const keys = Object.keys(draftSettings) as Array<keyof AppSettings>;
    for (const key of keys) {
      if (!areSettingsValuesEqual(draftSettings[key], settings[key])) {
        (updates as Record<string, unknown>)[key] = draftSettings[key];
      }
    }

    if (Object.keys(updates).length === 0) return;

    vscode?.postMessage({ type: 'update_settings', settings: updates });
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

import { useEffect, useRef, useState } from 'react';

import { vscode } from '@webview/utilities/vscode';

import type { AppSettings } from '@extension/core/settings';
import type { SettingsData } from '@extension/types/webview';

export function areSettingsValuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, index) => val === b[index]);
  }
  return a === b;
}

export interface UseSettingReturn {
  readonly draftSettings: AppSettings | null;
  readonly originalSettings: AppSettings | null;
  readonly isSaving: boolean;
  readonly isChangeDetected: boolean;
  readonly handleFieldChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  readonly handleSave: () => void;
  readonly resetDraft: () => void;
}

export const useSetting = (): UseSettingReturn => {
  const [originalSettings, setOriginalSettings] = useState<AppSettings | null>(null);
  const [draftSettings, setDraftSettings] = useState<AppSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const pendingUpdatesRef = useRef<SettingsData[]>([]);

  useEffect(() => {
    vscode?.postMessage({ type: 'get_settings' });
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'settings_data' && msg.payload?.settings) {
        const s = msg.payload.settings as AppSettings;
        setOriginalSettings(s);

        if (pendingUpdatesRef.current.length > 0) {
          pendingUpdatesRef.current = pendingUpdatesRef.current.slice(1);
          if (pendingUpdatesRef.current.length > 0) {
            const next = pendingUpdatesRef.current[0];
            vscode?.postMessage({ type: 'update_setting', key: next.key, value: next.value });
          } else {
            setIsSaving(false);
            setDraftSettings(s);
          }
        } else {
          setDraftSettings(s);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const isChangeDetected = (() => {
    if (!draftSettings || !originalSettings) return false;
    const keys = Object.keys(draftSettings) as Array<keyof AppSettings>;
    return keys.some((key) => !areSettingsValuesEqual(draftSettings[key], originalSettings[key]));
  })();

  const handleFieldChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void => {
    if (!draftSettings) return;
    setDraftSettings({ ...draftSettings, [key]: value });
  };

  const handleSave = (): void => {
    if (!draftSettings || !originalSettings || isSaving) return;

    const updates: SettingsData[] = [];
    const keys = Object.keys(draftSettings) as Array<keyof AppSettings>;
    for (const key of keys) {
      if (!areSettingsValuesEqual(draftSettings[key], originalSettings[key])) {
        updates.push({ key, value: draftSettings[key] });
      }
    }

    if (updates.length === 0) return;

    setIsSaving(true);
    pendingUpdatesRef.current = updates;
    vscode?.postMessage({ type: 'update_setting', key: updates[0].key, value: updates[0].value });
  };

  const resetDraft = (): void => {
    setDraftSettings(originalSettings);
  };

  return {
    draftSettings,
    originalSettings,
    isSaving,
    isChangeDetected,
    handleFieldChange,
    handleSave,
    resetDraft,
  };
};

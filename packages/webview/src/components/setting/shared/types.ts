import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import type { AppSettings } from '@pi-code/shared/core/settings';

export interface TabProps {
  readonly draftSettings: AppSettings;
  readonly handleFieldChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export interface SettingsTab {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly component: ComponentType<TabProps>;
}

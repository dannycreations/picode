import type { LucideIcon } from 'lucide-react';
import type { AppSettings, SettingKey, SettingSpecOf } from '@pi-code/shared/core/settings';

export type SettingsTabId = 'ability' | 'approval' | 'context';

export interface SettingsTab {
  readonly id: SettingsTabId;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
}

export interface SettingFieldBase {
  readonly tab: SettingsTabId;
  readonly label: string;
  readonly icon?: LucideIcon;
  readonly parent?: SettingKey;
}

export interface SettingListField extends SettingFieldBase {
  readonly placeholder: string;
}

export type SettingField<K extends SettingKey> = SettingSpecOf<K>['type'] extends 'string[]' ? SettingListField : SettingFieldBase;

export type SettingFieldRegistry = {
  readonly [K in SettingKey]: SettingField<K>;
};

export type SettingChangeHandler = (key: SettingKey, value: AppSettings[SettingKey]) => void;

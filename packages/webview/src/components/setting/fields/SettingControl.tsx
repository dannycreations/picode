import { getSettingSpec } from '@pi-code/shared/core/settings';
import { getChildFieldKeys, isFieldVisible, matchesQuery, SETTING_FIELDS } from '@pi-code/webview/components/setting/core/fields';
import { SettingCheckbox } from '@pi-code/webview/components/setting/fields/SettingCheckbox';
import { SettingList } from '@pi-code/webview/components/setting/fields/SettingList';
import { SettingSlider } from '@pi-code/webview/components/setting/fields/SettingSlider';

import type { FC } from 'react';
import type { AppSettings, SettingKey } from '@pi-code/shared/core/settings';
import type { SettingChangeHandler } from '@pi-code/webview/components/setting/core/types';

interface SettingControlProps {
  readonly settingKey: SettingKey;
  readonly draftSettings: AppSettings;
  readonly onChange: SettingChangeHandler;
  readonly searchQuery?: string;
  readonly parentMatched?: boolean;
}

export const SettingControl: FC<SettingControlProps> = ({ settingKey, draftSettings, onChange, searchQuery = '', parentMatched = false }) => {
  const spec = getSettingSpec(settingKey);
  const field = SETTING_FIELDS[settingKey];
  const value = draftSettings[settingKey];

  const currentMatched = parentMatched || (searchQuery.trim() ? matchesQuery(settingKey, searchQuery) : false);
  const childKeys = getChildFieldKeys(settingKey).filter((childKey) => isFieldVisible(childKey, searchQuery, currentMatched));
  const children = childKeys.length
    ? childKeys.map((childKey) => (
        <SettingControl
          key={childKey}
          settingKey={childKey}
          draftSettings={draftSettings}
          onChange={onChange}
          searchQuery={searchQuery}
          parentMatched={currentMatched}
        />
      ))
    : undefined;

  switch (spec.type) {
    case 'boolean': {
      return (
        <SettingCheckbox label={field.label} description={spec.description} checked={value === true} onChange={(next) => onChange(settingKey, next)}>
          {children}
        </SettingCheckbox>
      );
    }

    case 'number': {
      return (
        <SettingSlider
          label={field.label}
          description={spec.description}
          value={typeof value === 'number' ? value : spec.default}
          min={spec.minimum}
          max={spec.maximum}
          step={spec.step}
          unit={spec.unit}
          onChange={(next) => onChange(settingKey, next)}
        >
          {children}
        </SettingSlider>
      );
    }

    case 'string[]':
      return (
        <SettingList
          label={field.label}
          description={spec.description}
          placeholder={'placeholder' in field ? field.placeholder : ''}
          inputs={Array.isArray(value) ? value : []}
          onChange={(next) => onChange(settingKey, next)}
        />
      );
  }
};

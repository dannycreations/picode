import { formatModelSelection } from '@pi-code/shared/core/protocol';
import { getSettingSpec } from '@pi-code/shared/core/settings';
import { getChildFieldKeys, isFieldVisible, matchesQuery, SETTING_FIELDS } from '@pi-code/webview/components/setting/core/fields';
import { SettingCheckbox } from '@pi-code/webview/components/setting/fields/SettingCheckbox';
import { SettingList } from '@pi-code/webview/components/setting/fields/SettingList';
import { SettingSelect } from '@pi-code/webview/components/setting/fields/SettingSelect';
import { SettingSlider } from '@pi-code/webview/components/setting/fields/SettingSlider';
import { useChatStore } from '@pi-code/webview/stores/useChatStore';

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
  const models = useChatStore((state) => state.models);

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
      const resolvedValue = typeof value === 'number' ? value : spec.default;
      const showUnlimited = settingKey === 'retryOnError' && resolvedValue === spec.maximum;
      return (
        <SettingSlider
          label={field.label}
          description={spec.description}
          value={resolvedValue}
          formatValue={showUnlimited ? () => '∞' : undefined}
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

    case 'string': {
      // Empty value means "follow the chat selection"; keep an unknown stored
      // model visible instead of silently showing the default option.
      const options = [{ value: '', label: 'Use chat model' }, ...models.map((model) => ({ value: formatModelSelection(model), label: model.name }))];
      if (typeof value === 'string' && value !== '' && !options.some((option) => option.value === value)) {
        options.push({ value, label: value });
      }
      return (
        <SettingSelect
          label={field.label}
          description={spec.description}
          value={typeof value === 'string' ? value : ''}
          options={options}
          onChange={(next) => onChange(settingKey, next)}
        />
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

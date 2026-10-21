import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SettingModelSelect } from '@pi-code/webview/components/setting/fields/SettingModelSelect';

const MODEL_OPTIONS = [{ value: 'anthropic/claude', label: 'Claude Sonnet' }];

const renderSelect = (thinkingLevel: string, onChangeThinkingLevel = vi.fn()) => {
  render(
    <SettingModelSelect
      label="Commit message model"
      value="anthropic/claude"
      options={MODEL_OPTIONS}
      onChange={vi.fn()}
      thinkingLevel={thinkingLevel}
      thinkingLevels={['off', 'low', 'high']}
      onChangeThinkingLevel={onChangeThinkingLevel}
    />,
  );
  return onChangeThinkingLevel;
};

describe('SettingModelSelect', () => {
  it('capitalizes the selected thinking level, matching the open list', async () => {
    const user = userEvent.setup();
    renderSelect('low');

    const trigger = screen.getByRole('button', { name: 'low' });
    expect(trigger).toHaveTextContent('low');
    expect(trigger.querySelector('span')).toHaveClass('capitalize');

    await user.click(trigger);

    // The trigger and the list entry share an accessible name. The list entry
    // carries the class on the button, the trigger on its label.
    const [, listEntry] = screen.getAllByRole('button', { name: 'low' });
    expect(listEntry).toHaveTextContent('low');
    expect(listEntry).toHaveClass('capitalize');
  });

  it('leaves the model name out of the capitalization', () => {
    renderSelect('low');

    const trigger = screen.getByRole('button', { name: 'Claude Sonnet' });
    expect(trigger.querySelector('span')).not.toHaveClass('capitalize');
  });

  it('reports the chosen thinking level', async () => {
    const user = userEvent.setup();
    const onChangeThinkingLevel = renderSelect('low');

    await user.click(screen.getByRole('button', { name: 'low' }));
    await user.click(screen.getByRole('button', { name: 'high' }));

    expect(onChangeThinkingLevel).toHaveBeenCalledWith('high');
  });
});

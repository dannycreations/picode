import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';

import { DropdownMenu, DropdownMenuItem } from '@pi-code/webview/components/shared/DropdownMenu';
import { useClickOutside } from '@pi-code/webview/hooks/useClickOutside';

import type { FC, ReactNode } from 'react';
import type { ModelThinkingLevel } from '@pi-code/shared/core/types';

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

interface SelectButtonProps {
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly icon?: ReactNode;
  readonly itemClassName?: string;
}

const SelectButton: FC<SelectButtonProps> = ({ value, options, onChange, icon, itemClassName }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, () => setOpen(false));

  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="h-7 w-full px-2 text-xs rounded border border-vscode-focusBorder bg-vscode-settings-textInputBackground text-vscode-settings-textInputForeground outline-none hover:ring-1 hover:ring-vscode-focusBorder focus:ring-1 focus:ring-vscode-focusBorder flex items-center justify-between cursor-pointer"
      >
        {icon}
        <span className="truncate">{selected?.label ?? ''}</span>
        <ChevronDown size={12} className="shrink-0 ml-1" />
      </button>
      {open && (
        <DropdownMenu side="left" widthClass="w-full max-h-60" openUp={false}>
          <div className="overflow-y-auto flex-1 min-h-0 flex flex-col py-1">
            {options.map((option) => (
              <DropdownMenuItem
                key={option.value}
                label={option.label}
                className={itemClassName}
                selected={option.value === value}
                onSelect={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </DropdownMenu>
      )}
    </div>
  );
};

interface SettingModelSelectProps {
  readonly label: string;
  readonly description?: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
  readonly thinkingLevel: string;
  readonly thinkingLevels: readonly ModelThinkingLevel[];
  readonly onChangeThinkingLevel?: (value: string) => void;
}

export const SettingModelSelect: FC<SettingModelSelectProps> = ({
  label,
  description,
  value,
  options,
  onChange,
  thinkingLevel,
  thinkingLevels,
  onChangeThinkingLevel,
}) => {
  // Only surface the control once the model exposes more than its "off"
  // baseline, the same rule the footer uses.
  const showThinking = onChangeThinkingLevel !== undefined && thinkingLevels.length > 1;

  const thinkingOptions: SelectOption[] = [{ value: '', label: 'Default' }, ...thinkingLevels.map((level) => ({ value: level, label: level }))];
  // A level the selected model no longer offers stays visible instead of the
  // control silently showing the inherit option while the stored value differs.
  if (thinkingLevel !== '' && !thinkingOptions.some((option) => option.value === thinkingLevel)) {
    thinkingOptions.push({ value: thinkingLevel, label: thinkingLevel });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-vscode-foreground">{label}</span>
      <div className="flex flex-row gap-2 items-start">
        <div className="grow">
          <SelectButton value={value} options={options} onChange={onChange} />
        </div>
        {showThinking && (
          <div className="w-24 shrink-0">
            <SelectButton
              value={thinkingLevel}
              options={thinkingOptions}
              onChange={(next) => onChangeThinkingLevel?.(next)}
              itemClassName="capitalize"
            />
          </div>
        )}
      </div>
      {description && <div className="text-muted leading-normal">{description}</div>}
    </div>
  );
};

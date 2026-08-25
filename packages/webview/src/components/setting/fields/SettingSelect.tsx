import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';

import { DropdownMenu, DropdownMenuItem } from '@pi-code/webview/components/shared/DropdownMenu';
import { useClickOutside } from '@pi-code/webview/hooks/useClickOutside';

import type { FC } from 'react';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

interface SettingSelectProps {
  readonly label: string;
  readonly description?: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
}

export const SettingSelect: FC<SettingSelectProps> = ({ label, description, value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useClickOutside(containerRef, () => setOpen(false));

  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-vscode-foreground">{label}</span>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="h-7 w-full px-2 text-xs rounded border border-vscode-focusBorder bg-vscode-settings-textInputBackground text-vscode-settings-textInputForeground outline-none hover:ring-1 hover:ring-vscode-focusBorder focus:ring-1 focus:ring-vscode-focusBorder flex items-center justify-between cursor-pointer"
        >
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
      {description && <div className="text-muted leading-normal">{description}</div>}
    </div>
  );
};

import type { FC, ReactNode } from 'react';

interface SettingCheckboxProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly description?: string;
  readonly icon?: ReactNode;
  readonly children?: ReactNode;
}

export const SettingCheckbox: FC<SettingCheckboxProps> = ({ label, checked, onChange, description, icon, children }) => (
  <div className="flex flex-col gap-2 pt-4 border-t border-vscode-editorGroup-border/10">
    <label className="flex items-start gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border border-vscode-settings-checkboxBorder accent-vscode-button-background bg-vscode-settings-checkboxBackground cursor-pointer w-4 h-4 shrink-0 mt-0.5"
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 font-semibold text-sm text-vscode-foreground">
          {icon}
          <span>{label}</span>
        </div>
        {description && <span className="text-vscode-descriptionForeground text-xs leading-normal font-normal">{description}</span>}
      </div>
    </label>
    {checked && children && <div className="mt-1">{children}</div>}
  </div>
);

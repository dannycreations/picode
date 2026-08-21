import { Accordion } from '@pi-code/webview/components/shared/Accordion';

import type { FC, ReactNode } from 'react';

interface SettingCheckboxProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly description?: string;
  readonly children?: ReactNode;
}

export const SettingCheckbox: FC<SettingCheckboxProps> = ({ label, checked, onChange, description, children }) => (
  <div className="flex flex-col gap-2">
    <div className="flex flex-col gap-1">
      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="cursor-pointer w-4 h-4 shrink-0 mt-0.5" />
        <div className="flex items-center gap-1.5 font-semibold text-xs text-vscode-foreground">
          <span>{label}</span>
        </div>
      </label>
      {description && <span className="text-muted leading-normal">{description}</span>}
    </div>
    {children && (
      <Accordion open={checked}>
        <div className="mt-1 pl-3 border-l-2 border-vscode-button-background/60 flex flex-col gap-4">{children}</div>
      </Accordion>
    )}
  </div>
);

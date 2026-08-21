import type { FC, ReactNode } from 'react';

interface SettingSliderProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  readonly description?: string;
  readonly unit?: string;
  readonly step?: number;
  readonly children?: ReactNode;
}

export const SettingSlider: FC<SettingSliderProps> = ({ label, value, min, max, onChange, description, unit = '', step = 1, children }) => {
  const percentage = ((value - min) / (max - min)) * 100;
  const trackStyle = {
    background: `linear-gradient(to right, var(--vscode-button-background) ${percentage}%, var(--vscode-input-background) ${percentage}%)`,
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-vscode-foreground">
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-4">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          style={trackStyle}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="w-full appearance-none h-2 rounded-sm border border-vscode-settings-checkboxBorder outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-vscode-button-background [&::-webkit-slider-thumb]:border-none [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-vscode-button-background [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:cursor-pointer"
        />
        <span className="w-14 text-sm text-vscode-foreground text-right">
          {value}
          {unit}
        </span>
      </div>
      {description && <div className="text-muted leading-normal">{description}</div>}
      {children && <div className="mt-1 pl-3 border-l-2 border-vscode-button-background/60 flex flex-col gap-4">{children}</div>}
    </div>
  );
};

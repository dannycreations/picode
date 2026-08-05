import { Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';

import type { FC } from 'react';

interface SettingListProps {
  readonly label: string;
  readonly description: string;
  readonly placeholder: string;
  readonly inputs: readonly string[];
  readonly onChange: (inputs: string[]) => void;
}

export const SettingList: FC<SettingListProps> = ({ label, description, placeholder, inputs = [], onChange }) => {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!inputs.includes(trimmed)) {
      onChange([...inputs, trimmed]);
      setInput('');
    }
  };

  const handleRemove = (index: number) => {
    onChange(inputs.filter((_, i) => i !== index));
  };

  const handleEdit = (index: number, value: string) => {
    handleRemove(index);
    const trimmed = input.trim();
    setInput(trimmed ? `${trimmed} ${value}` : value);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col gap-2 mt-2.5 ml-6 pl-3 border-l-2 border-vscode-button-background/60">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold text-vscode-foreground">{label}</span>
        <span className="text-xs text-vscode-descriptionForeground leading-normal">{description}</span>
      </div>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={placeholder}
          className="h-7 px-2 text-xs rounded border border-vscode-settings-textInputBorder bg-vscode-settings-textInputBackground text-vscode-settings-textInputForeground outline-none focus:border-vscode-focusBorder grow"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="h-7 px-2.5 text-xs font-semibold rounded cursor-pointer bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground hover:bg-vscode-button-secondaryHoverBackground border border-vscode-editorGroup-border/50 flex items-center justify-center shrink-0"
        >
          <Plus size={14} />
        </button>
      </div>
      {inputs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {inputs.map((input, idx) => (
            <div
              key={`${input}-${idx}`}
              className="flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 text-xs rounded bg-vscode-badge-background text-vscode-badge-foreground border border-vscode-editorGroup-border/30"
            >
              <span
                role="button"
                tabIndex={0}
                className="font-mono truncate max-w-[200px] cursor-pointer hover:underline outline-none"
                title={`Click to edit: ${input}`}
                onClick={() => handleEdit(idx, input)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleEdit(idx, input);
                  }
                }}
              >
                {input}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(idx)}
                className="p-0.5 hover:bg-vscode-list-hoverBackground rounded text-vscode-badge-foreground bg-transparent border-none cursor-pointer flex items-center justify-center"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

import { cn } from 'cnfast';
import { Check, ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';

import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useClickOutside } from '@pi-code/webview/hooks/useClickOutside';

import type { FC } from 'react';
import type { ModelItem } from '@pi-code/shared/core/protocol';

interface ChatFooterProps {
  readonly currentModel: string;
  readonly onChangeModel: (model: string) => void;
  readonly models: ModelItem[];
}

interface ModelDropdownMenuProps {
  readonly models: ModelItem[];
  readonly currentModel: string;
  readonly onSelectModel: (modelId: string) => void;
}

const ModelDropdownMenu: FC<ModelDropdownMenuProps> = ({ models, currentModel, onSelectModel }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const filteredModels = models.filter(
    (m) => m.name.toLowerCase().includes(searchQuery.toLowerCase()) || m.id.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="absolute bottom-full left-0 mb-1 w-64 bg-vscode-dropdown-background border border-vscode-panel-border/50 rounded-md shadow-lg overflow-hidden flex flex-col z-50 max-h-60">
      <div className="p-2 border-b border-vscode-panel-border/50 shrink-0">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search models..."
          className="w-full px-2 py-1 text-xs bg-vscode-input-background text-vscode-input-foreground border border-vscode-focusBorder rounded outline-none hover:ring-1 hover:ring-vscode-focusBorder focus:ring-1 focus:ring-vscode-focusBorder"
          autoFocus
        />
      </div>
      <div className="overflow-y-auto flex-1 min-h-0 flex flex-col py-1">
        {filteredModels.length > 0 ? (
          filteredModels.map((m) => {
            const isSelected = currentModel === m.id;
            return (
              <button
                key={m.id}
                onClick={() => onSelectModel(m.id)}
                className={cn(
                  'w-full text-left px-3 py-1.5 border-none cursor-pointer flex items-center justify-between text-xs transition-colors shrink-0',
                  isSelected
                    ? 'bg-vscode-list-hoverBackground text-vscode-foreground'
                    : 'bg-transparent text-vscode-descriptionForeground hover:bg-vscode-list-hoverBackground/50 hover:text-vscode-foreground',
                )}
              >
                <span className="truncate mr-2">{m.name}</span>
                {isSelected && <Check size={10} className="text-vscode-focusBorder shrink-0" />}
              </button>
            );
          })
        ) : (
          <div className="px-3 py-2 text-muted text-center">No models found</div>
        )}
      </div>
    </div>
  );
};

export const ChatFooter: FC<ChatFooterProps> = ({ currentModel, onChangeModel, models }) => {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useClickOutside(dropdownRef, () => setShowModelMenu(false));

  const displayModels = [...models];
  if (currentModel && !models.some((m) => m.id === currentModel)) {
    displayModels.unshift({ id: currentModel, name: currentModel, provider: '' });
  }

  const selectedModelObj = displayModels.find((m) => m.id === currentModel) || displayModels[0] || { id: '', name: 'No model selected' };

  return (
    <div className="flex flex-row w-auto items-center justify-between h-[30px] mx-3.5 mt-1 mb-2 gap-1 shrink-0 select-none">
      <div className="flex flex-row justify-start gap-1 grow relative" ref={dropdownRef}>
        <Tooltip content={`Model: ${selectedModelObj.id}`}>
          <button
            onClick={() => setShowModelMenu(!showModelMenu)}
            className="px-2 py-0.5 text-muted hover:text-vscode-foreground bg-transparent hover:bg-vscode-list-hoverBackground border border-vscode-panel-border/50 rounded flex items-center gap-1 cursor-pointer truncate max-w-[180px]"
          >
            <span className="codicon codicon-robot scale-75" />
            <span className="truncate">{selectedModelObj.name}</span>
            <ChevronDown size={10} />
          </button>
        </Tooltip>

        {showModelMenu && (
          <ModelDropdownMenu
            models={displayModels}
            currentModel={currentModel}
            onSelectModel={(modelId) => {
              onChangeModel(modelId);
              setShowModelMenu(false);
            }}
          />
        )}
      </div>
    </div>
  );
};

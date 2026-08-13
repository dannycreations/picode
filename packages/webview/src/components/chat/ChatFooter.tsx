import { cn } from 'cnfast';
import { Check, ChevronDown, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';

import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';
import { useClickOutside } from '@pi-code/webview/hooks/useClickOutside';

import type { FC } from 'react';
import type { ModelItem } from '@pi-code/shared/core/protocol';
import type { ModelThinkingLevel } from '@pi-code/shared/core/types';

interface ChatFooterProps {
  readonly currentModel: string;
  readonly onChangeModel: (model: string) => void;
  readonly models: ModelItem[];
  readonly thinkingLevels: readonly ModelThinkingLevel[];
  readonly currentThinkingLevel: ModelThinkingLevel | null;
  readonly onChangeThinkingLevel: (level: ModelThinkingLevel) => void;
}

interface ModelDropdownMenuProps {
  readonly models: ModelItem[];
  readonly currentModel: string;
  readonly onSelectModel: (modelId: string) => void;
}

interface DropdownMenuItemProps {
  readonly label: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly className?: string;
}

const DropdownMenuItem: FC<DropdownMenuItemProps> = ({ label, selected, onSelect, className = '' }) => (
  <button
    onClick={onSelect}
    className={cn(
      'w-full text-left px-3 py-1.5 border-none cursor-pointer flex items-center justify-between text-xs transition-colors shrink-0',
      className,
      selected
        ? 'bg-vscode-list-hoverBackground text-vscode-foreground'
        : 'bg-transparent text-vscode-descriptionForeground hover:bg-vscode-list-hoverBackground/50 hover:text-vscode-foreground',
    )}
  >
    <span className="truncate mr-2">{label}</span>
    {selected && <Check size={10} className="text-vscode-focusBorder shrink-0" />}
  </button>
);

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
            return <DropdownMenuItem key={m.id} label={m.name} selected={isSelected} onSelect={() => onSelectModel(m.id)} />;
          })
        ) : (
          <div className="px-3 py-2 text-muted text-center">No models found</div>
        )}
      </div>
    </div>
  );
};

interface ThinkingLevelMenuProps {
  readonly levels: readonly ModelThinkingLevel[];
  readonly currentLevel: ModelThinkingLevel;
  readonly onSelectLevel: (level: ModelThinkingLevel) => void;
}

const ThinkingLevelMenu: FC<ThinkingLevelMenuProps> = ({ levels, currentLevel, onSelectLevel }) => {
  return (
    <div className="absolute bottom-full right-0 mb-1 w-32 bg-vscode-dropdown-background border border-vscode-panel-border/50 rounded-md shadow-lg overflow-hidden flex flex-col z-50 py-1">
      {levels.map((level) => {
        const isSelected = currentLevel === level;
        return <DropdownMenuItem key={level} label={level} selected={isSelected} onSelect={() => onSelectLevel(level)} className="capitalize" />;
      })}
    </div>
  );
};

export const ChatFooter: FC<ChatFooterProps> = ({
  currentModel,
  onChangeModel,
  models,
  thinkingLevels,
  currentThinkingLevel,
  onChangeThinkingLevel,
}) => {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showThinkingMenu, setShowThinkingMenu] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef<HTMLDivElement>(null);

  useClickOutside(dropdownRef, () => setShowModelMenu(false));
  useClickOutside(thinkingRef, () => setShowThinkingMenu(false));

  const displayModels = [...models];
  if (currentModel && !models.some((m) => m.id === currentModel)) {
    displayModels.unshift({ id: currentModel, name: currentModel, provider: '' });
  }

  const selectedModelObj = displayModels.find((m) => m.id === currentModel) || displayModels[0] || { id: '', name: 'No model selected' };

  // Only surface the control once the model exposes more than its "off" baseline.
  const showThinking = thinkingLevels.length > 1 && currentThinkingLevel !== null;

  return (
    <div className="flex flex-row w-auto items-center h-[30px] mx-3.5 mt-1 mb-2 gap-1 shrink-0 select-none">
      <div className="flex flex-row justify-start gap-1 relative" ref={dropdownRef}>
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

      {showThinking && (
        <div className="flex flex-row relative shrink-0" ref={thinkingRef}>
          <Tooltip content={`Thinking level: ${currentThinkingLevel}`}>
            <button
              onClick={() => setShowThinkingMenu(!showThinkingMenu)}
              className="px-2 py-0.5 text-muted hover:text-vscode-foreground bg-transparent hover:bg-vscode-list-hoverBackground border border-vscode-panel-border/50 rounded flex items-center gap-1 cursor-pointer capitalize"
            >
              <Sparkles size={10} />
              <span className="text-xs">{currentThinkingLevel}</span>
              <ChevronDown size={10} />
            </button>
          </Tooltip>

          {showThinkingMenu && (
            <ThinkingLevelMenu
              levels={thinkingLevels}
              currentLevel={currentThinkingLevel}
              onSelectLevel={(level) => {
                onChangeThinkingLevel(level);
                setShowThinkingMenu(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};

import { ChevronDown, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { DropdownMenu, DropdownMenuItem } from '@pi-code/webview/components/shared/DropdownMenu';
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

const ModelDropdownMenu: FC<ModelDropdownMenuProps> = ({ models, currentModel, onSelectModel }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const filteredModels = models.filter(
    (m) => m.name.toLowerCase().includes(searchQuery.toLowerCase()) || m.id.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // scrollIntoView would also scroll the chat's scroll container and jump the
  // page upward. Center the selected model inside the list itself by moving
  // only container.scrollTop, so no ancestor shifts.
  useEffect(() => {
    const container = listRef.current;
    const item = selectedItemRef.current;
    if (!container || !item) return;
    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const itemCenter = itemRect.top + itemRect.height / 2 - containerRect.top;
    container.scrollTop = container.scrollTop + itemCenter - container.clientHeight / 2;
  }, []);

  return (
    <DropdownMenu side="left" widthClass="w-64 max-h-60">
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
      <div ref={listRef} className="overflow-y-auto flex-1 min-h-0 flex flex-col py-1">
        {filteredModels.length > 0 ? (
          filteredModels.map((m) => {
            const isSelected = currentModel === m.id;
            return (
              <DropdownMenuItem
                key={m.id}
                label={m.name}
                selected={isSelected}
                onSelect={() => onSelectModel(m.id)}
                buttonRef={isSelected ? selectedItemRef : undefined}
              />
            );
          })
        ) : (
          <div className="px-3 py-2 text-muted text-center">No models found</div>
        )}
      </div>
    </DropdownMenu>
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
            <DropdownMenu side="right" widthClass="w-32 py-1">
              {thinkingLevels.map((level) => (
                <DropdownMenuItem
                  key={level}
                  label={level}
                  selected={currentThinkingLevel === level}
                  onSelect={() => {
                    onChangeThinkingLevel(level);
                    setShowThinkingMenu(false);
                  }}
                  className="capitalize"
                />
              ))}
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );
};

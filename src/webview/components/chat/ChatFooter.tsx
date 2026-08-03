import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { FC } from 'react';

interface ModelItem {
  readonly id: string;
  readonly name: string;
}

interface ChatFooterProps {
  readonly currentModel: string;
  readonly onChangeModel: (model: string) => void;
  readonly models: ModelItem[];
}

export const ChatFooter: FC<ChatFooterProps> = ({ currentModel, onChangeModel, models }) => {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Reset search when menu closes
  useEffect(() => {
    if (!showModelMenu) {
      setSearchQuery('');
    }
  }, [showModelMenu]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowModelMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasCurrentModel = models.some((m) => m.id === currentModel);
  const displayModels = [...models];
  if (currentModel && !hasCurrentModel) {
    displayModels.unshift({
      id: currentModel,
      name: currentModel,
    });
  }

  const selectedModelObj = displayModels.find((m) => m.id === currentModel) || displayModels[0] || { id: '', name: 'No model selected' };
  const filteredModels = displayModels.filter(
    (m) => m.name.toLowerCase().includes(searchQuery.toLowerCase()) || m.id.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="flex flex-row w-auto items-center justify-between h-[30px] mx-3.5 mt-1 mb-2 gap-1 shrink-0 select-none">
      {/* Model Selector (Left) */}
      <div className="flex flex-row justify-start gap-1 grow relative" ref={dropdownRef}>
        <button
          onClick={() => setShowModelMenu(!showModelMenu)}
          className="px-2 py-0.5 text-xs text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] bg-transparent hover:bg-[var(--vscode-list-hoverBackground)] border border-[var(--vscode-panel-border)]/40 rounded flex items-center gap-1 cursor-pointer truncate max-w-[180px]"
        >
          <span className="codicon codicon-robot scale-75"></span>
          <span className="truncate">{selectedModelObj.name}</span>
          <ChevronDown size={10} />
        </button>

        {showModelMenu && (
          <div className="absolute bottom-full left-0 mb-1 w-64 bg-[var(--vscode-dropdown-background)] border border-[var(--vscode-dropdown-border)] rounded-md shadow-lg overflow-hidden flex flex-col z-50 max-h-60">
            <div className="p-2 border-b border-[var(--vscode-panel-border)]/50 shrink-0">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search models..."
                className="w-full px-2 py-1 text-xs bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)]/60 rounded outline-none focus:border-[var(--vscode-focusBorder)]"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto flex-1 min-h-0 flex flex-col py-1">
              {filteredModels.length > 0 ? (
                filteredModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onChangeModel(m.id);
                      setShowModelMenu(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 border-none cursor-pointer flex items-center justify-between text-xs transition-colors shrink-0 ${
                      currentModel === m.id
                        ? 'bg-[var(--vscode-list-hoverBackground)] text-[var(--vscode-foreground)]'
                        : 'bg-transparent text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-list-hoverBackground)]/50 hover:text-[var(--vscode-foreground)]'
                    }`}
                  >
                    <span className="truncate mr-2">{m.name}</span>
                    {currentModel === m.id && <Check size={10} className="text-[var(--vscode-focusBorder)] shrink-0" />}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-[var(--vscode-descriptionForeground)] text-center">No models found</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right actions placeholder */}
      <div className="flex flex-row justify-end items-center gap-1.5" />
    </div>
  );
};

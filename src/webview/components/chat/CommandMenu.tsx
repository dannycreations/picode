import { cn } from 'cnfast';
import { useEffect, useMemo, useRef } from 'react';

import { COMMAND_SOURCE_LABEL } from '@webview/components/chat/helpers/command';

import type { FC } from 'react';
import type { CommandItem } from '@extension/types/webview';

export interface CommandMenuProps {
  readonly commands: readonly CommandItem[];
  readonly selectedIndex: number;
  readonly onSelect: (command: CommandItem) => void;
  readonly onHover: (index: number) => void;
}

export const CommandMenu: FC<CommandMenuProps> = ({ commands, selectedIndex, onSelect, onHover }) => {
  const listRef = useRef<HTMLDivElement>(null);

  // Only worth labelling the origin once more than one kind of command exists.
  const showSource = useMemo(() => new Set(commands.map((command) => command.source)).size > 1, [commands]);

  useEffect(() => {
    const selected = listRef.current?.children[selectedIndex];
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div
      className="absolute bottom-full left-3.5 right-3.5 z-50 mb-1 overflow-hidden rounded border border-vscode-editorGroup-border bg-vscode-dropdown-background shadow-lg"
      // Keep focus in the textarea so clicking a row does not blur-and-close first.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div ref={listRef} className="max-h-52 overflow-y-auto">
        {commands.map((command, index) => (
          <div
            key={command.name}
            role="option"
            aria-selected={index === selectedIndex}
            onClick={() => onSelect(command)}
            onMouseEnter={() => onHover(index)}
            className={cn(
              'flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 border-b border-vscode-editorGroup-border/40 last:border-b-0',
              index === selectedIndex ? 'bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground' : '',
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-semibold text-xs">/{command.name}</span>
              {showSource && (
                <span className="shrink-0 text-[0.7rem] uppercase tracking-wide text-vscode-descriptionForeground">
                  {COMMAND_SOURCE_LABEL[command.source]}
                </span>
              )}
            </div>
            {command.description && (
              <span
                className={cn('line-clamp-2 text-xs', index === selectedIndex ? 'opacity-80' : 'text-vscode-descriptionForeground')}
                title={command.detail}
              >
                {command.description}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-vscode-editorGroup-border bg-vscode-sideBar-background px-3 py-1 text-[0.7rem] text-vscode-descriptionForeground">
        <kbd>↑↓</kbd> navigate · <kbd>Tab</kbd> select · <kbd>Esc</kbd> dismiss
      </div>
    </div>
  );
};

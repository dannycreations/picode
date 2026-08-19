import { cn } from 'cnfast';
import { useEffect, useMemo, useRef } from 'react';

import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { ReactElement, ReactNode } from 'react';
import type { CommandItem } from '@pi-code/shared/core/protocol';

interface SuggestionMenuProps<T> {
  readonly items: readonly T[];
  readonly selectedIndex: number;
  readonly onSelect: (item: T) => void;
  readonly onHover: (index: number) => void;
  readonly renderItem: (item: T, isSelected: boolean) => ReactNode;
}

const SuggestionMenu = <T,>({ items, selectedIndex, onSelect, onHover, renderItem }: SuggestionMenuProps<T>): ReactElement | null => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selected = listRef.current?.children[selectedIndex];
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (items.length === 0) return null;

  return (
    <div
      className="absolute bottom-full -left-px -right-px z-50 mb-2 overflow-hidden rounded border border-vscode-editorGroup-border bg-vscode-dropdown-background shadow-lg"
      // Keep focus in the textarea so clicking a row does not blur-and-close first.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div ref={listRef} className="max-h-55 overflow-y-auto">
        {items.map((item, index) => (
          <div
            key={index}
            role="option"
            aria-selected={index === selectedIndex}
            onClick={() => onSelect(item)}
            onMouseEnter={() => onHover(index)}
            className={cn(
              'flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 border-b border-vscode-editorGroup-border/40 last:border-b-0',
              index === selectedIndex ? 'bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground' : '',
            )}
          >
            {renderItem(item, index === selectedIndex)}
          </div>
        ))}
      </div>

      <div className="border-t border-vscode-editorGroup-border bg-vscode-sideBar-background px-3 py-1 text-[0.7rem] text-vscode-descriptionForeground">
        <kbd>↑↓</kbd> navigate · <kbd>Tab</kbd> select · <kbd>Esc</kbd> dismiss
      </div>
    </div>
  );
};

interface CommandMenuProps {
  readonly commands: readonly CommandItem[];
  readonly selectedIndex: number;
  readonly onSelect: (command: CommandItem) => void;
  readonly onHover: (index: number) => void;
}

export const CommandMenu = ({ commands, selectedIndex, onSelect, onHover }: CommandMenuProps) => {
  // Only worth labelling the origin once more than one kind of command exists.
  const showSource = useMemo(() => new Set(commands.map((command) => command.source)).size > 1, [commands]);

  return (
    <SuggestionMenu<CommandItem>
      items={commands}
      selectedIndex={selectedIndex}
      onSelect={onSelect}
      onHover={onHover}
      renderItem={(command, isSelected) => (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-semibold text-xs">/{command.name}</span>
            {showSource && <span className="shrink-0 text-[0.7rem] uppercase tracking-wide text-vscode-descriptionForeground">{command.source}</span>}
          </div>
          {command.description && (
            <Tooltip content={command.detail} side="right">
              <span className={cn('line-clamp-2 text-xs', isSelected ? 'opacity-80' : 'text-vscode-descriptionForeground')}>
                {command.description}
              </span>
            </Tooltip>
          )}
        </>
      )}
    />
  );
};

interface MentionMenuProps {
  readonly results: readonly string[];
  readonly selectedIndex: number;
  readonly onSelect: (path: string) => void;
  readonly onHover: (index: number) => void;
}

export const MentionMenu = ({ results, selectedIndex, onSelect, onHover }: MentionMenuProps) => (
  <SuggestionMenu<string>
    items={results}
    selectedIndex={selectedIndex}
    onSelect={onSelect}
    onHover={onHover}
    renderItem={(path) => <span className={cn('truncate font-mono text-xs')}>{path}</span>}
  />
);

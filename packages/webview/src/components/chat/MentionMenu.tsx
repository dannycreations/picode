import { cn } from 'cnfast';
import { useEffect, useRef } from 'react';

import type { FC } from 'react';

interface MentionMenuProps {
  readonly results: readonly string[];
  readonly selectedIndex: number;
  readonly onSelect: (path: string) => void;
  readonly onHover: (index: number) => void;
}

export const MentionMenu: FC<MentionMenuProps> = ({ results, selectedIndex, onSelect, onHover }) => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selected = listRef.current?.children[selectedIndex];
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div
      className="absolute bottom-full -left-px -right-px z-50 mb-1 overflow-hidden rounded border border-vscode-editorGroup-border bg-vscode-dropdown-background shadow-lg"
      // Keep focus in the textarea so clicking a row does not blur-and-close first.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div ref={listRef} className="max-h-52 overflow-y-auto">
        {results.map((path, index) => (
          <div
            key={path}
            role="option"
            aria-selected={index === selectedIndex}
            onClick={() => onSelect(path)}
            onMouseEnter={() => onHover(index)}
            className={cn(
              'flex cursor-pointer flex-col gap-0.5 px-3 py-1.5 border-b border-vscode-editorGroup-border/40 last:border-b-0',
              index === selectedIndex ? 'bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground' : '',
            )}
          >
            <span className="truncate font-mono text-xs">{path}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-vscode-editorGroup-border bg-vscode-sideBar-background px-3 py-1 text-[0.7rem] text-vscode-descriptionForeground">
        <kbd>↑↓</kbd> navigate · <kbd>Tab</kbd> select · <kbd>Esc</kbd> dismiss
      </div>
    </div>
  );
};

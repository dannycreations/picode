import { cn } from 'cn';

import type { FC, ReactNode, Ref } from 'react';

interface DropdownMenuItemProps {
  readonly label: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly className?: string;
  readonly buttonRef?: Ref<HTMLButtonElement>;
}

export const DropdownMenuItem: FC<DropdownMenuItemProps> = ({ label, selected, onSelect, className = '', buttonRef }) => (
  <button
    ref={buttonRef}
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
  </button>
);

interface DropdownMenuProps {
  readonly side: 'left' | 'right';
  readonly widthClass: string;
  // Menus anchored to a bottom bar open upward; menus anchored to a top
  // header open downward.
  readonly openUp?: boolean;
  readonly children: ReactNode;
}

export const DropdownMenu: FC<DropdownMenuProps> = ({ side, widthClass, openUp = true, children }) => (
  <div
    className={cn(
      'absolute bg-vscode-dropdown-background border border-vscode-panel-border/50 rounded-md shadow-lg overflow-hidden flex flex-col z-50',
      openUp ? 'bottom-full mb-1' : 'top-full mt-1',
      side === 'left' ? 'left-0' : 'right-0',
      widthClass,
    )}
  >
    {children}
  </div>
);

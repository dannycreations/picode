import { cn } from 'cnfast';

import type { ComponentType, FC, MouseEvent } from 'react';

interface HistoryButtonProps {
  readonly icon: ComponentType<{ size?: number; className?: string }>;
  readonly title: string;
  readonly onClick: (e: MouseEvent) => void;
  readonly danger?: boolean;
}

export const HistoryButton: FC<HistoryButtonProps> = ({ icon: Icon, title, onClick, danger }) => (
  <button
    onClick={onClick}
    title={title}
    className={cn(
      'p-1 rounded bg-transparent border-none cursor-pointer flex items-center transition-colors hover:bg-[var(--vscode-list-hoverBackground)]',
      danger
        ? 'text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-errorForeground)]'
        : 'text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]',
    )}
  >
    <Icon size={12} />
  </button>
);

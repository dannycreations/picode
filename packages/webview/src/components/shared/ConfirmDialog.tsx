import { cn } from 'cnfast';
import { X } from 'lucide-react';
import React, { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';

import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC } from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'secondary' | 'danger';
}

interface ConfirmDialogProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly description?: string;
  readonly warningText?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

const useModalKeyboard = ({ isOpen, onEscape, onEnter }: { isOpen: boolean; onEscape?: () => void; onEnter?: () => void }) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger 'Enter' confirm if user is focusing an input/textarea
      const target = e.target as HTMLElement | null;
      const isInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      if (e.key === 'Escape' && onEscape) {
        e.preventDefault();
        onEscape();
      } else if (e.key === 'Enter' && onEnter && !isInput) {
        e.preventDefault();
        onEnter();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onEscape, onEnter]);
};

const Button: FC<ButtonProps> = ({ variant = 'secondary', children, className = '', disabled, ...props }) => {
  const baseStyles =
    'px-3 py-1.5 text-xs font-semibold rounded cursor-pointer transition-colors border flex items-center justify-center gap-2 select-none disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    secondary: 'bg-transparent hover:bg-[var(--vscode-list-hoverBackground)] border-[var(--vscode-panel-border)]/50 text-[var(--vscode-foreground)]',
    danger: 'bg-[var(--vscode-errorForeground)]/90 hover:bg-[var(--vscode-errorForeground)] text-white border-transparent',
  };

  return (
    <button disabled={disabled} className={cn(baseStyles, variants[variant], className)} {...props}>
      {children}
    </button>
  );
};

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  warningText = 'This action cannot be undone. Please confirm you want to continue.',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) => {
  const titleId = useId();
  const descriptionId = useId();

  useModalKeyboard({ isOpen, onEscape: onCancel, onEnter: onConfirm });

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 select-none">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded-md w-full max-w-md overflow-hidden flex flex-col shadow-xl"
      >
        <div className="px-4 py-3 bg-[var(--vscode-sideBarSectionHeader-background)] border-b border-[var(--vscode-panel-border)]/50 flex justify-between items-center">
          <h3 id={titleId} className="font-semibold text-xs uppercase tracking-wider text-[var(--vscode-foreground)] m-0">
            {title}
          </h3>
          <Tooltip content="Close dialog" side="left">
            <button
              onClick={onCancel}
              className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-vscode-list-hoverBackground text-vscode-descriptionForeground hover:text-vscode-foreground bg-transparent border-none cursor-pointer"
            >
              <X size={14} />
            </button>
          </Tooltip>
        </div>

        <div className="p-4 flex flex-col gap-3 text-xs leading-relaxed text-[var(--vscode-foreground)]">
          {description && (
            <p id={descriptionId} className="m-0 text-[var(--vscode-foreground)]">
              {description}
            </p>
          )}

          {warningText && (
            <div className="text-[var(--vscode-errorForeground)] bg-[var(--vscode-input-background)] p-3 rounded border border-[var(--vscode-panel-border)]/50 text-xs">
              {warningText}
            </div>
          )}
        </div>

        <div className="px-4 py-3 bg-[var(--vscode-sideBarSectionHeader-background)]/50 border-t border-[var(--vscode-panel-border)]/50 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

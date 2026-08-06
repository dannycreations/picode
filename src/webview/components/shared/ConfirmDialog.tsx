import { cn } from 'cnfast';
import { X } from 'lucide-react';
import React, { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';

import type { FC, ReactNode } from 'react';

export type DialogVariant = 'danger' | 'warning' | 'primary';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'ghost' | 'secondary' | 'danger' | 'primary';
  readonly isLoading?: boolean;
}

export interface ModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly ariaLabelledBy?: string;
  readonly ariaDescribedBy?: string;
}

export interface ConfirmDialogProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly description?: string;
  readonly warningText?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly variant?: DialogVariant;
  readonly isLoading?: boolean;
  readonly children?: ReactNode;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

interface UseModalKeyboardOptions {
  readonly isOpen: boolean;
  readonly onEscape?: () => void;
  readonly onEnter?: () => void;
}

const useModalKeyboard = ({ isOpen, onEscape, onEnter }: UseModalKeyboardOptions) => {
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

export const Button: FC<ButtonProps> = ({ variant = 'secondary', isLoading = false, children, className = '', disabled, ...props }) => {
  const baseStyles =
    'px-3 py-1.5 text-xs font-semibold rounded cursor-pointer transition-colors border flex items-center justify-center gap-2 select-none disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    ghost:
      'bg-transparent border-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] p-0 text-base leading-none',
    secondary: 'bg-transparent hover:bg-[var(--vscode-list-hoverBackground)] border-[var(--vscode-panel-border)]/50 text-[var(--vscode-foreground)]',
    primary:
      'bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] border-transparent',
    danger: 'bg-[var(--vscode-errorForeground)]/90 hover:bg-[var(--vscode-errorForeground)] text-white border-transparent',
  };

  return (
    <button disabled={disabled || isLoading} className={cn(baseStyles, variants[variant], className)} {...props}>
      {isLoading ? <span className="animate-spin text-xs">🌀</span> : null}
      {children}
    </button>
  );
};

export const ModalPortal: FC<{ children: ReactNode }> = ({ children }) => {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
};

export const Modal: FC<ModalProps> = ({ isOpen, children, ariaLabelledBy, ariaDescribedBy }) => {
  if (!isOpen) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 select-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded-md w-full max-w-md overflow-hidden flex flex-col shadow-xl"
        >
          {children}
        </div>
      </div>
    </ModalPortal>
  );
};

export const ModalHeader: FC<{ children: ReactNode; onClose?: () => void }> = ({ children, onClose }) => (
  <div className="px-4 py-3 bg-[var(--vscode-sideBarSectionHeader-background)] border-b border-[var(--vscode-panel-border)]/50 flex justify-between items-center">
    {children}
    {onClose && (
      <button
        onClick={onClose}
        title="Close dialog"
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-vscode-list-hoverBackground text-vscode-descriptionForeground hover:text-vscode-foreground bg-transparent border-none cursor-pointer"
      >
        <X size={14} />
      </button>
    )}
  </div>
);

export const ModalBody: FC<{ children: ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={cn('p-4 flex flex-col gap-3 text-xs leading-relaxed text-[var(--vscode-foreground)]', className)}>{children}</div>
);

export const ModalFooter: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="px-4 py-3 bg-[var(--vscode-sideBarSectionHeader-background)]/50 border-t border-[var(--vscode-panel-border)]/50 flex justify-end gap-2">
    {children}
  </div>
);

const VARIANT_BUTTON_MAP: Record<DialogVariant, 'danger' | 'primary'> = {
  danger: 'danger',
  warning: 'primary',
  primary: 'primary',
};

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  warningText = 'This action cannot be undone. Please confirm you want to continue.',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  variant = 'danger',
  isLoading = false,
  children,
  onConfirm,
  onCancel,
}) => {
  const titleId = useId();
  const descriptionId = useId();

  useModalKeyboard({ isOpen, onEscape: onCancel, onEnter: onConfirm });

  return (
    <Modal isOpen={isOpen} onClose={onCancel} ariaLabelledBy={titleId} ariaDescribedBy={description ? descriptionId : undefined}>
      <ModalHeader onClose={onCancel}>
        <h3 id={titleId} className="font-semibold text-xs uppercase tracking-wider text-[var(--vscode-foreground)] m-0">
          {title}
        </h3>
      </ModalHeader>

      <ModalBody>
        {description && (
          <p id={descriptionId} className="m-0 text-[var(--vscode-foreground)]">
            {description}
          </p>
        )}

        {children}

        {warningText && (
          <div className="text-[var(--vscode-errorForeground)] bg-[var(--vscode-input-background)] p-3 rounded border border-[var(--vscode-panel-border)]/50 text-xs">
            {warningText}
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onCancel} disabled={isLoading}>
          {cancelLabel}
        </Button>
        <Button variant={VARIANT_BUTTON_MAP[variant]} onClick={onConfirm} isLoading={isLoading}>
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

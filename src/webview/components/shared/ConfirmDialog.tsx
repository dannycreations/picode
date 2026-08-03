import { useEffect } from 'react';

import type { FC } from 'react';

interface ConfirmDialogProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly description: string;
  readonly warningText?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

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
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter') {
        onConfirm();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 select-none">
      <div className="bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded-md w-full max-w-sm overflow-hidden flex flex-col shadow-xl">
        {/* Header */}
        <div className="px-4 py-3 bg-[var(--vscode-sideBarSectionHeader-background)] border-b border-[var(--vscode-panel-border)]/50 flex justify-between items-center">
          <h3 className="font-semibold text-xs uppercase tracking-wider text-[var(--vscode-foreground)] m-0">{title}</h3>
          <button
            onClick={onCancel}
            className="bg-transparent border-none text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] cursor-pointer text-base leading-none"
            title="Close"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col gap-3 text-xs leading-relaxed text-[var(--vscode-foreground)]">
          <p className="m-0 text-[var(--vscode-foreground)]">{description}</p>
          {warningText && (
            <div className="text-[var(--vscode-errorForeground)] bg-[var(--vscode-input-background)] p-3 rounded border border-[var(--vscode-panel-border)]/50 text-[11px]">
              {warningText}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-[var(--vscode-sideBarSectionHeader-background)]/50 border-t border-[var(--vscode-panel-border)]/50 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-transparent hover:bg-[var(--vscode-list-hoverBackground)] border border-[var(--vscode-panel-border)]/50 text-[var(--vscode-foreground)] cursor-pointer transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-[var(--vscode-errorForeground)]/90 hover:bg-[var(--vscode-errorForeground)] text-white border-none cursor-pointer transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

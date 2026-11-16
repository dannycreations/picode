import { cn } from 'cn';
import { Check, Copy } from 'lucide-react';

import { useCopyToClipboard } from '@pi-code/webview/hooks/useCopyToClipboard';

import type { ButtonHTMLAttributes } from 'react';

interface CopyButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly text: string;
  readonly size?: number;
}

export function CopyButton({ text, className, size = 14, onClick, ...rest }: CopyButtonProps) {
  const { showCopy, copy } = useCopyToClipboard();
  return (
    <button
      type="button"
      className={cn('icon-button', className)}
      onClick={(e) => {
        void copy(text, e);
        onClick?.(e);
      }}
      {...rest}
    >
      {showCopy ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

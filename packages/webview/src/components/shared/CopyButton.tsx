import { cn } from 'cn';
import { Check, Copy } from 'lucide-react';
import { forwardRef } from 'react';

import { useCopyToClipboard } from '@pi-code/webview/hooks/useCopyToClipboard';

import type { ButtonHTMLAttributes } from 'react';

interface CopyButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly text: string;
  readonly size?: number;
}

export const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(({ text, className, size = 14, onClick, ...rest }, ref) => {
  const { showCopy, copy } = useCopyToClipboard();

  return (
    <button
      ref={ref}
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
});

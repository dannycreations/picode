import { cn } from 'cnfast';

import type { CSSProperties, FC } from 'react';

interface SpinnerProps {
  readonly size?: number;
  readonly className?: string;
}

export const Spinner: FC<SpinnerProps> = ({ size = 14, className }) => (
  <span
    role="status"
    aria-label="Working"
    className={cn('codicon codicon-loading codicon-modifier-spin shrink-0', className)}
    style={{ fontSize: size, width: size, height: size } as CSSProperties}
  />
);

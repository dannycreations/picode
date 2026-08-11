import { cn } from 'cnfast';

import type { FC } from 'react';

const SPINNER_STYLE = { fontSize: 14, width: 14, height: 14 };

interface SpinnerProps {
  readonly className?: string;
}

export const Spinner: FC<SpinnerProps> = ({ className }) => (
  <span
    role="status"
    aria-label="Working"
    className={cn('codicon codicon-loading codicon-modifier-spin shrink-0', className)}
    style={SPINNER_STYLE}
  />
);

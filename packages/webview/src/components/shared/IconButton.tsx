import { cn } from 'cn';

import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC, MouseEvent } from 'react';
import type { TooltipSide } from '@pi-code/webview/components/shared/helpers/tooltip';

interface IconButtonProps {
  // Codicon name without the `codicon-` prefix, e.g. `zoom-in`.
  readonly icon: string;
  readonly tooltip: string;
  readonly side?: TooltipSide;
  readonly className?: string;
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

export const IconButton: FC<IconButtonProps> = ({ icon, tooltip, side, className, onClick }) => (
  <Tooltip content={tooltip} side={side}>
    <button type="button" className="icon-button" onClick={onClick}>
      <span className={cn('codicon', `codicon-${icon}`, className)} />
    </button>
  </Tooltip>
);

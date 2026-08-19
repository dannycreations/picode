import { cn } from 'cnfast';

import type { FC, ReactNode } from 'react';

interface AccordionProps {
  readonly open: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

export const Accordion: FC<AccordionProps> = ({ open, children, className }) => (
  <div
    className={cn('grid transition-all duration-200 ease-out', open ? 'opacity-100' : 'opacity-0', className)}
    style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
  >
    <div className="min-h-0 overflow-hidden">{children}</div>
  </div>
);

import { cn } from 'cn';

import { formatTime } from '@pi-code/webview/utilities/common';

import type { FC, ReactNode } from 'react';

interface MessageHeaderProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly timestamp: number;
  readonly onClick?: () => void;
  readonly children?: ReactNode;
}

export const MessageHeader: FC<MessageHeaderProps> = ({ icon, title, timestamp, onClick, children }) => (
  <div
    className={cn(
      'flex items-center gap-2 mb-1.5 break-words font-semibold text-vscode-foreground opacity-85 select-none',
      onClick ? 'cursor-pointer' : '',
    )}
    onClick={onClick}
  >
    {icon}
    <span className="font-bold">{title}</span>
    {children}
    <span className="text-muted font-normal ml-auto">{formatTime(timestamp)}</span>
  </div>
);

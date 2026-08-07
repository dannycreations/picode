import { cn } from 'cnfast';

import { formatTime } from '@webview/components/chat/messages/helpers/common';

import type { FC, ReactNode } from 'react';

interface MessageHeaderProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly timestamp: number;
  readonly titleClassName?: string;
  readonly onClick?: () => void;
  readonly children?: ReactNode;
}

export const MessageHeader: FC<MessageHeaderProps> = ({ icon, title, timestamp, titleClassName = '', onClick, children }) => (
  <div
    className={cn(
      'flex items-center gap-2 mb-1.5 break-words font-semibold text-vscode-foreground opacity-85 select-none',
      onClick ? 'cursor-pointer' : '',
    )}
    onClick={onClick}
  >
    {icon}
    <span className={cn('font-bold', titleClassName)}>{title}</span>
    {children}
    <span className="text-xs text-vscode-descriptionForeground font-normal ml-auto">{formatTime(timestamp)}</span>
  </div>
);

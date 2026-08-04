import { formatTime } from '@extension/webview/components/chat/messages/helpers/common';

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
    className={`flex items-center gap-2.5 mb-1.5 break-words font-semibold text-vscode-foreground opacity-85 select-none ${
      onClick ? 'cursor-pointer' : ''
    }`}
    onClick={onClick}
  >
    {icon}
    <span className={`font-bold ${titleClassName}`}>{title}</span>
    {children}
    <span className="text-[10px] text-vscode-descriptionForeground font-normal ml-auto">{formatTime(timestamp)}</span>
  </div>
);

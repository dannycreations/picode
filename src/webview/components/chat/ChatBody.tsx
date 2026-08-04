import { AssistantMessage } from '@extension/webview/components/chat/messages/AssistantMessage';
import { ApiRequestMessage, CheckpointMessage, ErrorMessage, InfoMessage } from '@extension/webview/components/chat/messages/StatusMessage';
import { ToolMessage } from '@extension/webview/components/chat/messages/ToolMessage';
import { UserMessage } from '@extension/webview/components/chat/messages/UserMessage';

import type { FC } from 'react';
import type { ChatMessage } from '@extension/types/webview';

interface ChatBodyProps {
  readonly message: ChatMessage;
  readonly isLast: boolean;
  readonly onApproveTool: (msgId: string) => void;
  readonly onDenyTool: (msgId: string) => void;
  readonly onRestoreCheckpoint: (hash: string) => void;
}

export const ChatBody: FC<ChatBodyProps> = ({ message, onApproveTool, onDenyTool, onRestoreCheckpoint }) => {
  const renderMessageContent = () => {
    switch (message.sender) {
      case 'user':
        return <UserMessage message={message} />;
      case 'assistant':
        return <AssistantMessage message={message} />;
      case 'tool':
        return <ToolMessage message={message} onApproveTool={onApproveTool} onDenyTool={onDenyTool} />;
      case 'checkpoint':
        return <CheckpointMessage message={message} onRestoreCheckpoint={onRestoreCheckpoint} />;
      case 'api_request':
        return <ApiRequestMessage message={message} />;
      case 'error':
        return <ErrorMessage message={message} />;
      case 'info':
        return <InfoMessage message={message} />;
      default:
        return null;
    }
  };

  const content = renderMessageContent();
  if (!content) return null;

  return <div className="px-[15px] py-[10px] pr-[6px] relative border-b border-vscode-editorGroup-border/30">{content}</div>;
};

import { AssistantMessage } from '@extension/webview/components/chat/messages/AssistantMessage';
import { QuestionMessage } from '@extension/webview/components/chat/messages/QuestionMessage';
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
  readonly onAnswerQuestion: (questionId: string, text: string) => void;
  readonly onCopyToInput: (text: string) => void;
  readonly onRestoreCheckpoint: (hash: string) => void;
}

export const ChatBody: FC<ChatBodyProps> = ({ message, onApproveTool, onDenyTool, onAnswerQuestion, onCopyToInput, onRestoreCheckpoint }) => {
  const renderMessageContent = () => {
    switch (message.sender) {
      case 'user':
        return <UserMessage message={message} />;
      case 'assistant': {
        const hasReasoning = !!message.reasoning && message.reasoning.trim() !== '';
        const hasText = !!message.text && message.text.trim() !== '';

        if (!hasReasoning && !hasText) return null;

        return <AssistantMessage message={message} hasReasoning={hasReasoning} hasText={hasText} />;
      }
      case 'tool':
        if (message.toolName === 'ask_question') {
          return <QuestionMessage message={message} onAnswerQuestion={onAnswerQuestion} onCopyToInput={onCopyToInput} />;
        }
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

  return <div className="px-3.5 py-2.5 relative border-b border-vscode-editorGroup-border/30">{content}</div>;
};

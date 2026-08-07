import { memo } from 'react';

import { getRowContainmentStyle } from '@extension/webview/components/chat/helpers/message';
import { AssistantMessage } from '@extension/webview/components/chat/messages/AssistantMessage';
import { QuestionMessage } from '@extension/webview/components/chat/messages/QuestionMessage';
import { ApiRequestMessage, ErrorMessage, InfoMessage } from '@extension/webview/components/chat/messages/StatusMessage';
import { ToolMessage } from '@extension/webview/components/chat/messages/ToolMessage';
import { UserMessage } from '@extension/webview/components/chat/messages/UserMessage';

import type { ChatMessage, CommandItem } from '@extension/types/webview';

interface ChatBodyProps {
  readonly message: ChatMessage;
  readonly commands: readonly CommandItem[];
  readonly onApproveTool: (msgId: string) => void;
  readonly onDenyTool: (msgId: string) => void;
  readonly onAnswerQuestion: (questionId: string, text: string) => void;
  readonly onCopyToInput: (text: string) => void;
}

export const ChatBody = memo<ChatBodyProps>(({ message, commands, onApproveTool, onDenyTool, onAnswerQuestion, onCopyToInput }) => {
  const renderMessageContent = () => {
    switch (message.sender) {
      case 'user':
        return <UserMessage message={message} commands={commands} />;
      case 'assistant':
        return <AssistantMessage message={message} />;
      case 'tool':
        if (message.toolName === 'ask_question') {
          return <QuestionMessage message={message} onAnswerQuestion={onAnswerQuestion} onCopyToInput={onCopyToInput} />;
        }
        return <ToolMessage message={message} onApproveTool={onApproveTool} onDenyTool={onDenyTool} />;
      case 'api_request':
        return <ApiRequestMessage message={message} />;
      case 'error':
        return <ErrorMessage message={message} />;
      case 'checkpoint':
      case 'info':
        return <InfoMessage message={message} />;
    }
  };

  return (
    <div className="chat-row px-3.5 py-2.5 relative border-b border-vscode-editorGroup-border/30" style={getRowContainmentStyle(message.sender)}>
      {renderMessageContent()}
    </div>
  );
});

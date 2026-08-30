import { memo } from 'react';

import { AssistantMessage } from '@pi-code/webview/components/chat/messages/AssistantMessage';
import { QuestionMessage } from '@pi-code/webview/components/chat/messages/QuestionMessage';
import { ApiRequestMessage, ErrorMessage, InfoMessage } from '@pi-code/webview/components/chat/messages/StatusMessage';
import { ToolMessage } from '@pi-code/webview/components/chat/messages/ToolMessage';
import { QueueMessage, UserMessage } from '@pi-code/webview/components/chat/messages/UserMessage';
import { TodoBody } from '@pi-code/webview/components/chat/TodoView';

import type { CommandItem } from '@pi-code/shared/core/protocol';
import type { Attachment, ChatMessage } from '@pi-code/shared/core/types';
import type { TodoItem } from '@pi-code/shared/utilities/todo';
import type { SearchContext } from '@pi-code/webview/components/shared/Highlight';

interface ChatBodyProps {
  readonly message: ChatMessage;
  readonly oldTodos?: readonly TodoItem[];
  readonly commands: readonly CommandItem[];
  readonly search?: SearchContext;
  readonly onRespondTool: (msgId: string, approved: boolean) => void;
  readonly onAnswerQuestion: (questionId: string, text: string, attachments?: Attachment[]) => void;
  readonly onCopyToInput: (text: string) => void;
}

export const ChatBody = memo<ChatBodyProps>(({ message, oldTodos, commands, search, onRespondTool, onAnswerQuestion, onCopyToInput }) => {
  const renderMessageContent = () => {
    switch (message.sender) {
      case 'user':
        return <UserMessage message={message} commands={commands} search={search} />;
      case 'queue':
        return <QueueMessage message={message} commands={commands} search={search} />;
      case 'assistant':
        return <AssistantMessage message={message} search={search} />;
      case 'tool':
        if (message.toolName === 'ask_question') {
          return <QuestionMessage message={message} search={search} onAnswerQuestion={onAnswerQuestion} onCopyToInput={onCopyToInput} />;
        }
        if (message.toolName === 'update_todo' && message.toolStatus !== 'denied') {
          return <TodoBody oldTodos={oldTodos ?? []} newTodos={message.todos ?? []} timestamp={message.timestamp} />;
        }
        return <ToolMessage message={message} onRespondTool={onRespondTool} />;
      case 'api_request':
        return <ApiRequestMessage message={message} />;
      case 'error':
        return <ErrorMessage message={message} search={search} />;
      case 'checkpoint':
      case 'info':
        return <InfoMessage message={message} search={search} />;
    }
  };

  const content = renderMessageContent();
  if (content === null) return null;
  return <div className="chat-row px-3.5 py-2.5 relative border-b border-vscode-editorGroup-border/30">{content}</div>;
});

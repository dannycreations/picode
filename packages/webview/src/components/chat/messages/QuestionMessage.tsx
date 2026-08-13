import { cn } from 'cnfast';
import { ClipboardCopy, CornerDownRight, MessageCircleQuestionMark, ShieldAlert } from 'lucide-react';

import { parseQuestionAnswer, parseQuestionData } from '@pi-code/webview/components/chat/helpers/question';
import { Markdown } from '@pi-code/webview/components/chat/markdown/Markdown';
import { MessageHeader } from '@pi-code/webview/components/chat/messages/MessageHeader';
import { Tooltip } from '@pi-code/webview/components/shared/Tooltip';

import type { FC, MouseEvent } from 'react';
import type { ChatMessage } from '@pi-code/shared/core/types';

interface QuestionMessageProps {
  readonly message: ChatMessage;
  readonly onAnswerQuestion: (questionId: string, text: string) => void;
  readonly onCopyToInput: (text: string) => void;
}

export const QuestionMessage: FC<QuestionMessageProps> = ({ message, onAnswerQuestion, onCopyToInput }) => {
  const data = parseQuestionData(message.toolArgs);
  const question = data?.question ?? message.text;
  const suggestions = data?.suggestions ?? [];

  // The tool call stays in flight until the user replies, so its status is the
  // single source of truth for whether the card is still interactive.
  const isPending = message.toolStatus === 'running';
  const isCancelled = message.toolStatus === 'denied';
  const answer = isCancelled ? '' : parseQuestionAnswer(message.diff);

  const handleSuggestionClick = (event: MouseEvent<HTMLButtonElement>, suggestion: string) => {
    // Shift-click mirrors the chat conventions: stage the suggestion in the
    // input box so it can be edited instead of answering right away.
    if (event.shiftKey) {
      onCopyToInput(suggestion);
      return;
    }
    onAnswerQuestion(message.id, suggestion);
  };

  return (
    <div className="group flex flex-col gap-1.5">
      <MessageHeader
        icon={<MessageCircleQuestionMark size={14} className="text-vscode-focusBorder shrink-0" />}
        title="Pi Code has a question"
        timestamp={message.ts}
      />

      <div className="ml-6 flex flex-col gap-2 text-sm">
        <div className="leading-normal text-vscode-foreground select-text">
          <Markdown markdown={question} />
        </div>

        {isPending && suggestions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {suggestions.map((suggestion, idx) => (
              <div key={`${idx}-${suggestion}`} className="relative group/suggestion">
                <button
                  onClick={(event) => handleSuggestionClick(event, suggestion)}
                  className="w-full px-3 py-2 pr-9 text-left text-sm leading-normal whitespace-normal break-words rounded-md border border-vscode-editorGroup-border bg-vscode-input-background text-vscode-foreground hover:bg-vscode-list-hoverBackground hover:border-vscode-focusBorder cursor-pointer transition-colors"
                >
                  {suggestion}
                </button>
                <Tooltip content="Edit before answering (Shift+Click)" side="left">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onCopyToInput(suggestion);
                    }}
                    className="absolute top-1.5 right-1.5 p-1 rounded bg-vscode-input-background text-vscode-descriptionForeground hover:text-vscode-foreground border-none cursor-pointer opacity-0 group-hover/suggestion:opacity-100 transition-opacity"
                  >
                    <ClipboardCopy size={12} />
                  </button>
                </Tooltip>
              </div>
            ))}
          </div>
        )}

        {isPending && (
          <div className="text-muted select-none">
            {suggestions.length > 0 ? 'Pick an answer above or type your own reply below.' : 'Type your reply below to answer.'}
          </div>
        )}

        {!isPending && (answer || isCancelled) && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-vscode-editorGroup-border bg-vscode-input-background">
            {isCancelled ? (
              <ShieldAlert size={14} className="mt-0.5 shrink-0 text-vscode-errorForeground" />
            ) : (
              <CornerDownRight size={14} className="mt-0.5 shrink-0 text-vscode-focusBorder" />
            )}
            <span
              className={cn(
                'whitespace-pre-wrap break-words select-text',
                isCancelled ? 'text-vscode-descriptionForeground' : 'text-vscode-foreground',
              )}
            >
              {isCancelled ? 'No response was provided.' : answer}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

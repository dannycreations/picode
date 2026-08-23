import type { ChatMessage, ToolArguments, ToolChatMessage } from '@pi-code/shared/core/types';

interface QuestionData {
  readonly question: string;
  readonly suggestions: string[];
}

interface RawQuestionArgs {
  readonly question?: unknown;
  readonly follow_up?: unknown;
}

export function parseQuestionData(toolArgs?: ToolArguments): QuestionData | undefined {
  const parsed = toolArgs as RawQuestionArgs | undefined;
  if (!parsed || typeof parsed.question !== 'string') return undefined;

  const followUp = Array.isArray(parsed.follow_up) ? parsed.follow_up : [];
  const suggestions = followUp
    .map((item) => (typeof item === 'string' ? item : ((item as { text?: unknown })?.text ?? '')))
    .filter((text): text is string => typeof text === 'string' && text.trim() !== '');

  return { question: parsed.question, suggestions };
}

interface QuestionView {
  readonly question: string;
  readonly suggestions: string[];
  readonly answer: string;
}

export function getQuestionView(message: ToolChatMessage): QuestionView {
  const data = parseQuestionData(message.toolArgs);
  return {
    question: data?.question ?? message.text,
    suggestions: data?.suggestions ?? [],
    answer: message.toolStatus === 'denied' ? '' : (message.diff ?? ''),
  };
}

export function findPendingQuestion(messages: readonly ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.sender === 'tool' && msg.toolName === 'ask_question' && msg.toolStatus === 'running') {
      return msg;
    }
  }
  return undefined;
}

import { extractResultText, safeJsonParse } from '@pi-code/webview/components/chat/messages/helpers/common';

import type { ChatMessage } from '@pi-code/shared/core/types';

interface QuestionData {
  readonly question: string;
  readonly suggestions: string[];
}

interface RawQuestionArgs {
  readonly question?: unknown;
  readonly follow_up?: unknown;
}

interface RawQuestionResult {
  readonly details?: { response?: unknown };
  readonly content?: Array<{ text?: unknown }>;
}

export function parseQuestionData(toolArgs?: string): QuestionData | undefined {
  const parsed = safeJsonParse<RawQuestionArgs>(toolArgs);
  if (!parsed || typeof parsed.question !== 'string') return undefined;

  const followUp = Array.isArray(parsed.follow_up) ? parsed.follow_up : [];
  const suggestions = followUp
    .map((item) => (typeof item === 'string' ? item : ((item as { text?: unknown })?.text ?? '')))
    .filter((text): text is string => typeof text === 'string' && text.trim() !== '');

  return { question: parsed.question, suggestions };
}

export function parseQuestionAnswer(diff?: string): string {
  if (!diff) return '';

  const parsed = safeJsonParse<RawQuestionResult>(diff);
  if (!parsed) return diff.trim();

  const text = extractResultText(parsed);
  return text ? text.trim() : '';
}

export function findPendingQuestion(messages: readonly ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.toolName === 'ask_question' && msg.toolStatus === 'running') {
      return msg;
    }
  }
  return undefined;
}

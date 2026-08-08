import type { ChatMessage } from '@pi-code/shared/protocol';

export interface QuestionData {
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

function parseJson<T>(raw?: string): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function parseQuestionData(toolArgs?: string): QuestionData | undefined {
  const parsed = parseJson<RawQuestionArgs>(toolArgs);
  if (!parsed || typeof parsed.question !== 'string') return undefined;

  const followUp = Array.isArray(parsed.follow_up) ? parsed.follow_up : [];
  const suggestions = followUp
    .map((item) => (typeof item === 'string' ? item : ((item as { text?: unknown })?.text ?? '')))
    .filter((text): text is string => typeof text === 'string' && text.trim() !== '');

  return { question: parsed.question, suggestions };
}

export function parseQuestionAnswer(diff?: string): string {
  if (!diff) return '';

  const parsed = parseJson<RawQuestionResult>(diff);
  if (!parsed) return diff.trim();

  if (typeof parsed.details?.response === 'string') {
    return parsed.details.response.trim();
  }
  if (Array.isArray(parsed.content) && typeof parsed.content[0]?.text === 'string') {
    return parsed.content[0].text.trim();
  }

  return '';
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

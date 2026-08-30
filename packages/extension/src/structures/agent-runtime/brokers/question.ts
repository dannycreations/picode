import { createRequestRegistry } from '@pi-code/extension/structures/agent-runtime/brokers/registry';

import type { Attachment } from '@pi-code/shared/core/types';

interface QuestionAnswer {
  readonly text: string;
  readonly attachments?: readonly Attachment[];
}

const questions = createRequestRegistry<QuestionAnswer | null>();

export function askQuestion(questionId: string, signal?: AbortSignal): Promise<QuestionAnswer | null> {
  // Settle any in-flight question that still carries this id.
  questions.resolve(questionId, null);

  if (signal?.aborted) {
    return Promise.resolve(null);
  }

  return new Promise<QuestionAnswer | null>((resolve) => {
    const onAbort = (): void => {
      questions.resolve(questionId, null);
    };

    questions.register(questionId, (answer) => {
      signal?.removeEventListener('abort', onAbort);
      resolve(answer);
    });

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function answerQuestion(questionId: string, text: string, attachments?: readonly Attachment[]): boolean {
  return questions.resolve(questionId, { text, attachments });
}

export function cancelAllQuestions(): void {
  questions.cancelAll(null);
}

import { createRequestRegistry } from '@pi-code/extension/structures/agent-runtime/brokers/registry';

const questions = createRequestRegistry<string | null>();

export function askQuestion(questionId: string, signal?: AbortSignal): Promise<string | null> {
  // Settle any in-flight question that still carries this id.
  questions.resolve(questionId, null);

  if (signal?.aborted) {
    return Promise.resolve(null);
  }

  return new Promise<string | null>((resolve) => {
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

export function answerQuestion(questionId: string, text: string): boolean {
  return questions.resolve(questionId, text);
}

export function cancelAllQuestions(): void {
  questions.cancelAll(null);
}

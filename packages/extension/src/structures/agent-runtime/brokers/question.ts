type QuestionResolver = (answer: string | null) => void;

const resolvers = new Map<string, QuestionResolver>();

function settle(questionId: string, answer: string | null): boolean {
  const resolve = resolvers.get(questionId);
  if (!resolve) {
    return false;
  }

  resolvers.delete(questionId);
  resolve(answer);

  return true;
}

export function askQuestion(questionId: string, signal?: AbortSignal): Promise<string | null> {
  // Cancel an existing question with the same ID.
  resolvers.get(questionId)?.(null);

  if (signal?.aborted) {
    return Promise.resolve(null);
  }

  return new Promise<string | null>((resolve) => {
    const onAbort = (): void => {
      settle(questionId, null);
    };

    const resolver: QuestionResolver = (answer) => {
      if (!resolvers.has(questionId)) {
        return;
      }

      resolvers.delete(questionId);
      signal?.removeEventListener('abort', onAbort);
      resolve(answer);
    };

    resolvers.set(questionId, resolver);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function answerQuestion(questionId: string, text: string): boolean {
  return settle(questionId, text);
}

export function cancelAllQuestions(): void {
  for (const resolve of [...resolvers.values()]) {
    resolve(null);
  }

  resolvers.clear();
}

type QuestionResolver = (answer: string | null) => void;

export class QuestionBridge {
  private static instance: QuestionBridge | null = null;

  private readonly pending = new Map<string, QuestionResolver>();

  public static getInstance(): QuestionBridge {
    if (!this.instance) {
      this.instance = new QuestionBridge();
    }
    return this.instance;
  }

  public ask(questionId: string, signal?: AbortSignal): Promise<string | null> {
    this.pending.get(questionId)?.(null);

    if (signal?.aborted) {
      return Promise.resolve(null);
    }

    return new Promise<string | null>((resolve) => {
      const settle = (answer: string | null): void => {
        if (!this.pending.has(questionId)) return;
        this.pending.delete(questionId);
        signal?.removeEventListener('abort', onAbort);
        resolve(answer);
      };

      const onAbort = (): void => settle(null);

      this.pending.set(questionId, settle);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  public answer(questionId: string, text: string): boolean {
    const resolve = this.pending.get(questionId);
    if (!resolve) return false;

    resolve(text);
    return true;
  }

  public cancelAll(): void {
    for (const resolve of [...this.pending.values()]) {
      resolve(null);
    }
    this.pending.clear();
  }
}

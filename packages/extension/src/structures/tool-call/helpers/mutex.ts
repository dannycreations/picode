export class FileMutex {
  private activeLocks = new Map<string, Promise<void>>();

  public async acquire(path: string): Promise<() => void> {
    const existing = this.activeLocks.get(path);
    let resolveFn!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveFn = resolve;
    });

    this.activeLocks.set(path, promise);

    if (existing) {
      try {
        await existing;
      } catch {}
    }

    return () => {
      resolveFn();
      if (this.activeLocks.get(path) === promise) {
        this.activeLocks.delete(path);
      }
    };
  }
}

export const fileMutex = new FileMutex();

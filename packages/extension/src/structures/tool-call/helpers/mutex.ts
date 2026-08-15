const activeLocks = new Map<string, Promise<void>>();

export async function acquireFileLock(path: string): Promise<() => void> {
  const existing = activeLocks.get(path);
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  activeLocks.set(path, promise);

  if (existing) {
    try {
      await existing;
    } catch {}
  }

  return () => {
    release();
    if (activeLocks.get(path) === promise) {
      activeLocks.delete(path);
    }
  };
}

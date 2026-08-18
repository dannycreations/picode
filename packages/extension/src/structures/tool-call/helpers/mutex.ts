const activeLocks = new Map<string, Promise<void>>();

async function acquireFileLock(path: string): Promise<() => void> {
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

export async function withFileLock<T>(resolvedPath: string, run: () => Promise<T>): Promise<T> {
  const release = await acquireFileLock(resolvedPath);
  try {
    return await run();
  } finally {
    release();
  }
}

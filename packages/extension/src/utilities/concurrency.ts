export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  signal: undefined,
  run: (item: T) => Promise<R>,
  onResult?: (results: readonly (R | undefined)[]) => void,
): Promise<R[]>;
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  signal: AbortSignal | undefined,
  run: (item: T) => Promise<R>,
  onResult?: (results: readonly (R | undefined)[]) => void,
): Promise<Array<R | undefined>>;
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  signal: AbortSignal | undefined,
  run: (item: T) => Promise<R>,
  onResult?: (results: readonly (R | undefined)[]) => void,
): Promise<Array<R | undefined>> {
  const results: (R | undefined)[] = Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length && !signal?.aborted) {
      const index = nextIndex++;
      results[index] = await run(items[index]);
      onResult?.(results);
    }
  });

  await Promise.all(workers);
  // Without a signal every item is started, so every slot is filled. An
  // aborted run leaves the items it never reached unset.
  return results;
}

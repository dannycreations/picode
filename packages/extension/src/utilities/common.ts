export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  signal: AbortSignal | undefined,
  run: (item: T) => Promise<R>,
  onResult?: (results: readonly (R | undefined)[], index: number) => void,
): Promise<R[]> {
  const results: (R | undefined)[] = Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length && !signal?.aborted) {
      const index = nextIndex++;
      results[index] = await run(items[index]);
      onResult?.(results, index);
    }
  });

  await Promise.all(workers);
  return results as R[];
}

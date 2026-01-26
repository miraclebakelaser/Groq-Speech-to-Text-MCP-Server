export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  maxConcurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const concurrency = Math.max(1, Math.floor(maxConcurrency));
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      if (currentIndex >= items.length) return;
      nextIndex += 1;
      results[currentIndex] = await fn(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}


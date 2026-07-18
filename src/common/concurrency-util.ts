export async function mapWithConcurrency<T, TResult>(
    items: readonly T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<TResult>,
) {
    if (!items.length) {
        return [];
    }

    const results = new Array<TResult>(items.length);
    const workerCount = Math.min(
        items.length,
        Math.max(1, Math.floor(concurrency) || 1),
    );
    let nextIndex = 0;

    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await mapper(items[index], index);
        }
    }));

    return results;
}

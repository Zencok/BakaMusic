interface ICacheEntry<T> {
    value: T;
    weight: number;
}

/** Small LRU with both entry and retained-memory ceilings. */
export default class BoundedLruCache<T> {
    private entries = new Map<string, ICacheEntry<T>>();
    private retainedWeight = 0;

    constructor(
        private readonly maximumEntries: number,
        private readonly maximumWeight: number,
    ) {}

    get size() {
        return this.entries.size;
    }

    get weight() {
        return this.retainedWeight;
    }

    get(key: string) {
        const entry = this.entries.get(key);
        if (!entry) {
            return undefined;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    set(key: string, value: T, weight: number) {
        this.delete(key);
        if (
            !Number.isFinite(weight)
            || weight < 0
            || weight > this.maximumWeight
        ) {
            return false;
        }

        this.entries.set(key, { value, weight });
        this.retainedWeight += weight;
        while (
            this.entries.size > this.maximumEntries
            || this.retainedWeight > this.maximumWeight
        ) {
            const oldestKey = this.entries.keys().next().value;
            if (oldestKey === undefined) {
                break;
            }
            this.delete(oldestKey);
        }
        return this.entries.has(key);
    }

    delete(key: string) {
        const entry = this.entries.get(key);
        if (!entry) {
            return false;
        }
        this.retainedWeight -= entry.weight;
        return this.entries.delete(key);
    }
}

export function estimateStringBytes(value: string) {
    // Conservative across V8's one-byte and two-byte string representations.
    return value.length * 2;
}

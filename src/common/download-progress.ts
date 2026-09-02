/** Human-visible progress does not benefit from frame-rate IPC updates. */
export const DOWNLOAD_PROGRESS_UPDATE_INTERVAL_MS = 250;

/** Matches the NodeRuntime pending-RPC ceiling and bounds background memory. */
export const MAX_BUFFERED_DOWNLOAD_PROGRESS_TASKS = 256;

/** Latest-value buffer used before delivering progress across a throttled UI boundary. */
export class LatestDownloadProgressBuffer<T extends { taskId: string }> {
    private entries = new Map<string, T>();

    constructor(
        private readonly maximumEntries = MAX_BUFFERED_DOWNLOAD_PROGRESS_TASKS,
    ) {}

    get size() {
        return this.entries.size;
    }

    upsert(entry: T) {
        if (this.entries.has(entry.taskId)) {
            this.entries.delete(entry.taskId);
        } else if (this.entries.size >= this.maximumEntries) {
            const oldestTaskId = this.entries.keys().next().value;
            if (oldestTaskId !== undefined) {
                this.entries.delete(oldestTaskId);
            }
        }
        this.entries.set(entry.taskId, entry);
    }

    delete(taskId: string) {
        return this.entries.delete(taskId);
    }

    drain() {
        const batch = [...this.entries.values()];
        this.entries.clear();
        return batch;
    }

    clear() {
        this.entries.clear();
    }
}

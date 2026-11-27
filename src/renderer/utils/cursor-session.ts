import { RequestStateCode } from "@/common/constant";

export interface CursorSnapshot<T, E = IMedia.IMediaBase> {
    items: T[];
    entity?: E;
    nextCursor: string | null;
    loaded: boolean;
    status: RequestStateCode;
}

/** A continuation belongs to one request generation and advances only on success. */
export class CursorSession<T, E = IMedia.IMediaBase> {
    private generation = 0;
    private pending: Promise<void> | null = null;
    private cursors = new Set<string>();
    private revision: string | undefined;
    private listeners = new Set<() => void>();
    private value: CursorSnapshot<T, E>;

    constructor(entity?: E, items: T[] = []) {
        this.value = { entity, items, nextCursor: null, loaded: false, status: RequestStateCode.IDLE };
    }
    getSnapshot = () => this.value;
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    private publish(value: CursorSnapshot<T, E>) {
        this.value = value;
        this.listeners.forEach((listener) => listener());
    }
    invalidate() {
        this.generation += 1;
        this.pending = null;
        if (this.value.status === RequestStateCode.PENDING_FIRST_PAGE || this.value.status === RequestStateCode.PENDING_REST_PAGE) {
            this.publish({ ...this.value, status: this.value.loaded ? RequestStateCode.PARTLY_DONE : RequestStateCode.IDLE });
        }
    }
    load(fetch: (cursor: string | null) => Promise<IPlugin.Page<T>>): Promise<void> {
        if (this.pending) return this.pending;
        if (this.value.loaded && this.value.nextCursor === null) return Promise.resolve();
        const generation = this.generation;
        const previous = this.value;
        this.publish({ ...previous, status: previous.loaded ? RequestStateCode.PENDING_REST_PAGE : RequestStateCode.PENDING_FIRST_PAGE });
        // Defer the request so pending is installed even when fetch throws synchronously.
        const pending = Promise.resolve().then(() => fetch(previous.nextCursor)).then((page) => {
            if (generation !== this.generation) return;
            if (!page || !Array.isArray(page.items) || !(page.nextCursor === null || typeof page.nextCursor === "string")) {
                throw new Error("Invalid continuation response");
            }
            if (page.nextCursor !== null && (!page.items.length || new TextEncoder().encode(page.nextCursor).byteLength > 2048 || !page.nextCursor || this.cursors.has(page.nextCursor) || page.nextCursor === previous.nextCursor)) {
                throw new Error("Repeated continuation");
            }
            const expected = previous.entity as Partial<IMedia.IMediaBase> | undefined;
            if (page.entity && expected?.platform && (page.entity.platform !== expected.platform || page.entity.id !== expected.id)) {
                throw new Error("Collection response changed entity identity");
            }
            const revision = JSON.stringify([page.revision, page.accountRevision, page.sourceRevision]);
            if (previous.loaded && this.revision !== revision) throw new Error("Collection changed while loading");
            this.revision = revision;
            if (page.nextCursor !== null) this.cursors.add(page.nextCursor);
            this.publish({
                items: previous.loaded ? previous.items.concat(page.items) : page.items,
                entity: page.entity ? { ...previous.entity, ...page.entity } as E : previous.entity,
                nextCursor: page.nextCursor,
                loaded: true,
                status: page.nextCursor === null ? RequestStateCode.FINISHED : RequestStateCode.PARTLY_DONE,
            });
        }).catch(() => {
            if (generation === this.generation) this.publish({ ...previous, status: RequestStateCode.ERROR });
        }).finally(() => {
            if (generation === this.generation) this.pending = null;
        });
        this.pending = pending;
        return pending;
    }
}

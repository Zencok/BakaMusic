import { importedTracks, type IImportSourceSnapshot } from "./import-sync";

type ImportCall = (plugin: IPlugin.IPluginDelegate, input: string, options?: IPlugin.IImportMusicSheetOptions) => Promise<IPlugin.IImportMusicSheetResult | null>;
interface CachedSnapshot {
    version: string;
    musicList: IMusic.IMusicItem[];
    expiresAt: number;
    bytes: number;
}

/** Global bounded scheduler: 3 different plugins, one request per plugin, in-flight deduplication. */
export class ImportSyncFetcher {
    private generation = 0;
    private active = 0;
    private activePlugins = new Set<string>();
    private queue: { pluginKey: string; run: () => Promise<void> }[] = [];
    private inFlight = new Map<string, Promise<IMusic.IMusicItem[]>>();
    private cache = new Map<string, CachedSnapshot>();
    private cacheBytes = 0;

    constructor(private call: ImportCall, private now = Date.now) {}

    /** Config/plugin changes invalidate validators and reject stale results; credentials are never keys. */
    invalidate() {
        this.generation++;
        this.cache.clear();
        this.cacheBytes = 0;
    }

    getRevision() {
        return this.generation;
    }

    private forget(key: string) {
        const value = this.cache.get(key);
        if (value) {
            this.cacheBytes -= value.bytes;
            this.cache.delete(key);
        }
    }

    private pump() {
        while (this.active < 3) {
            const index = this.queue.findIndex((job) => !this.activePlugins.has(job.pluginKey));
            if (index < 0) {
                return;
            }
            const [job] = this.queue.splice(index, 1);
            this.active++;
            this.activePlugins.add(job.pluginKey);
            void job.run().finally(() => {
                this.active--;
                this.activePlugins.delete(job.pluginKey);
                this.pump();
            });
        }
    }

    private async load(key: string, plugin: IPlugin.IPluginDelegate, input: string, generation: number) {
        if (generation !== this.generation) {
            throw new Error("Sync context changed");
        }
        for (const [cachedKey, value] of this.cache) {
            if (value.expiresAt <= this.now()) {
                this.forget(cachedKey);
            }
        }
        const cached = this.cache.get(key);
        // A validator never substitutes for a request: the plugin must confirm freshness.
        const result = await this.call(plugin, input, cached ? { knownVersion: cached.version } : undefined);
        if (generation !== this.generation) {
            throw new Error("Sync context changed");
        }
        if (result && !Array.isArray(result) && result.notModified === true) {
            if (!cached || result.syncVersion !== cached.version) {
                throw new Error("Invalid not-modified response");
            }
            this.cache.delete(key);
            this.cache.set(key, cached);
            return cached.musicList;
        }
        const musicList = importedTracks(result);
        const version = result && !Array.isArray(result) ? result.syncVersion : undefined;
        this.forget(key);
        if (typeof version === "string" && version.length > 0 && version.length <= 1000 && musicList.length <= 50_000) {
            // Count actual serialized UTF-8 bytes, not only the number of tracks/artwork strings.
            const bytes = new TextEncoder().encode(JSON.stringify(musicList)).byteLength;
            if (bytes <= 8 * 1024 * 1024) {
                while (this.cache.size >= 16 || this.cacheBytes + bytes > 8 * 1024 * 1024) {
                    const oldest = this.cache.keys().next().value;
                    if (oldest === undefined) {
                        break;
                    }
                    this.forget(oldest);
                }
                this.cache.set(key, { version, musicList, bytes, expiresAt: this.now() + 5 * 60_000 });
                this.cacheBytes += bytes;
            }
        }
        return musicList;
    }

    async fetch(source: IMusic.IImportedSheetSource, plugin: IPlugin.IPluginDelegate): Promise<IImportSourceSnapshot> {
        const generation = this.generation;
        const key = JSON.stringify([generation, plugin.hash, plugin.platform, source.input.trim()]);
        let promise = this.inFlight.get(key);
        if (!promise) {
            if (this.inFlight.size >= 200) {
                throw new Error("sync_sheet_busy");
            }
            promise = new Promise<IMusic.IMusicItem[]>((resolve, reject) => {
                this.queue.push({ pluginKey: plugin.hash, run: async () => {
                    try {
                        resolve(await this.load(key, plugin, source.input, generation));
                    } catch (error) {
                        this.forget(key);
                        reject(error);
                    } finally {
                        this.inFlight.delete(key);
                    }
                } });
            });
            this.inFlight.set(key, promise);
            this.pump();
        }
        return { source, musicList: await promise };
    }
}

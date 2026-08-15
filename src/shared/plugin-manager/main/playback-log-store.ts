import { app } from "electron";
import fs from "fs/promises";
import path from "path";
import logger from "@shared/logger/main";
import { toError } from "@/common/error-util";
import {
    isPluginPlaybackLogEntry,
    isPluginPlaybackLogEvent,
    PLUGIN_PLAYBACK_LOG_LIMIT,
    type PluginPlaybackLogEntry,
    type PluginPlaybackLogEvent,
} from "../playback-log";

const MAX_LOG_FILE_BYTES = 4 * 1024 * 1024;

type EntryListener = (entry: PluginPlaybackLogEntry) => void;

export default class PlaybackLogStore {
    private entries: PluginPlaybackLogEntry[] = [];
    private sequence = 0;
    private queuedSnapshot: string | null = null;
    private writePromise: Promise<void> | null = null;

    constructor(private readonly onEntry: EntryListener) {}

    private get logPath() {
        return path.resolve(app.getPath("userData"), "plugin-playback-log.ndjson");
    }

    async setup() {
        try {
            const stat = await fs.stat(this.logPath);
            if (!stat.isFile() || stat.size > MAX_LOG_FILE_BYTES) {
                await this.persist();
                return;
            }
            const rawLog = await fs.readFile(this.logPath, "utf8");
            this.entries = rawLog
                .split(/\r?\n/u)
                .filter(Boolean)
                .flatMap((line) => {
                    try {
                        const entry = JSON.parse(line) as unknown;
                        return isPluginPlaybackLogEntry(entry) ? [entry] : [];
                    } catch {
                        return [];
                    }
                })
                .slice(-PLUGIN_PLAYBACK_LOG_LIMIT);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException)?.code;
            if (code !== "ENOENT") {
                logger.logError("Failed to load plugin playback logs", toError(error));
            }
        }
    }

    append(event: PluginPlaybackLogEvent) {
        if (!isPluginPlaybackLogEvent(event)) {
            return;
        }
        const entry: PluginPlaybackLogEntry = {
            ...event,
            id: `${event.timestamp}-${++this.sequence}-${event.callId}`.slice(0, 160),
        };
        delete (entry as Partial<PluginPlaybackLogEvent>).type;
        this.entries = [...this.entries, entry].slice(-PLUGIN_PLAYBACK_LOG_LIMIT);
        this.onEntry(entry);
        void this.persist();
    }

    getEntries() {
        return this.entries.map((entry) => ({ ...entry }));
    }

    async clear() {
        this.entries = [];
        await this.persist();
    }

    private persist() {
        this.queuedSnapshot = this.entries
            .map((entry) => JSON.stringify(entry))
            .join("\n");
        if (!this.writePromise) {
            this.writePromise = this.flushWrites().finally(() => {
                this.writePromise = null;
                if (this.queuedSnapshot !== null) {
                    void this.persist();
                }
            });
        }
        return this.writePromise;
    }

    private async flushWrites() {
        while (this.queuedSnapshot !== null) {
            const snapshot = this.queuedSnapshot;
            this.queuedSnapshot = null;
            const temporaryPath = `${this.logPath}.${process.pid}.tmp`;
            try {
                await fs.mkdir(path.dirname(this.logPath), { recursive: true });
                await fs.writeFile(temporaryPath, snapshot ? `${snapshot}\n` : "", "utf8");
                await fs.rename(temporaryPath, this.logPath);
            } catch (error) {
                logger.logError("Failed to persist plugin playback logs", toError(error));
            } finally {
                await fs.rm(temporaryPath, { force: true }).catch((): undefined => undefined);
            }
        }
    }
}

import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 64 * 1024 * 1024;
export interface LxImportOrigin {
    originalId: string;
    locator: string;
    rawSha256: string;
    legacyHash?: string;
}
export interface LegacyLxSource {
    code: string;
    hash: string;
    path: string;
    sourceUrl?: string;
}
interface MigrationState {
    version: 1;
    selectedHash?: string | null;
    migrated: Record<string, string>;
    boundProviders: string[];
}
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
async function boundedText(filePath: string, limit: number) {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > limit) throw new Error("LX source or metadata exceeds the accepted size");
    const text = await fs.readFile(filePath, "utf8");
    if (Buffer.byteLength(text) > limit) throw new Error("LX source or metadata exceeds the accepted size");
    return text;
}

/** Original LX files stay untouched; this journal prevents migration resurrection after uninstall. */
export class LxImportStore {
    private state: MigrationState = { version: 1, migrated: {}, boundProviders: [] };
    private writeQueue: Promise<unknown> = Promise.resolve();
    constructor(private readonly userDataPath: string) {}
    private get journalPath() {
        return path.join(this.userDataPath, "lx-v2-migrations.json");
    }
    async setup() {
        try {
            const value = JSON.parse(await boundedText(this.journalPath, MAX_METADATA_BYTES));
            if (value?.version !== 1 || !value.migrated || typeof value.migrated !== "object" || Array.isArray(value.migrated)) return;
            this.state.migrated = Object.fromEntries(Object.entries(value.migrated).filter(([hash, id]) =>
                /^[a-f0-9]{64}$/.test(hash) && typeof id === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)).slice(0, 1000)) as Record<string, string>;
            this.state.boundProviders = Array.isArray(value.boundProviders) ? value.boundProviders
                .filter((id: unknown) => typeof id === "string" && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)).slice(0, 1000) : [];
            if (value.selectedHash === null || typeof value.selectedHash === "string" && /^[a-f0-9]{64}$/.test(value.selectedHash)) this.state.selectedHash = value.selectedHash;
        } catch { /* Missing or invalid journals never grant execution or resolver bindings. */ }
    }
    get selectedId() {
        return this.state.selectedHash ? this.state.migrated[this.state.selectedHash] : undefined;
    }
    getMigratedId(hash: string) {
        return this.state.migrated[hash];
    }
    hasBindingDecision(providerId: string) {
        return this.state.boundProviders.includes(providerId);
    }
    async recordMigration(hash: string, pluginId: string) {
        this.state.migrated[hash] = pluginId;
        await this.persist();
    }
    async recordBindingDecision(providerId: string) {
        if (!/^cc\.baka\.(wy|qq|kg|kw|mg)$/.test(providerId)) return;
        if (!this.state.boundProviders.includes(providerId)) this.state.boundProviders.push(providerId);
        await this.persist();
    }
    private persist() {
        const body = JSON.stringify(this.state);
        const operation = this.writeQueue.then(async () => {
            const temporary = `${this.journalPath}.${process.pid}.${Date.now()}.tmp`;
            try {
                await fs.writeFile(temporary, body, { flag: "wx", encoding: "utf8" });
                await fs.rename(temporary, this.journalPath);
            } finally {
                await fs.rm(temporary, { force: true }).catch(() => undefined);
            }
        });
        this.writeQueue = operation.catch(() => undefined);
        return operation;
    }
    async discover(onFailure: (filePath: string, error: unknown) => void) {
        const directory = path.join(this.userDataPath, "bakamusic-lx-plugins");
        const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
        let selection: string | null | undefined;
        try {
            const state = JSON.parse(await boundedText(path.join(directory, "state.json"), MAX_METADATA_BYTES));
            if (Object.prototype.hasOwnProperty.call(state, "activeHash")) {
                selection = typeof state.activeHash === "string" && /^[a-f0-9]{64}$/.test(state.activeHash) ? state.activeHash : null;
            }
        } catch { /* Old installations without a state file selected their first valid script. */ }
        const result: LegacyLxSource[] = [];
        let totalBytes = 0;
        for (const entry of entries.slice(0, 300)) {
            if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".js") continue;
            const filePath = path.join(directory, entry.name);
            try {
                const code = await boundedText(filePath, MAX_SOURCE_BYTES);
                const integrity = JSON.parse(await boundedText(`${filePath}.integrity.json`, MAX_METADATA_BYTES));
                const hash = digest(code);
                if (integrity.sha256 !== hash) throw new Error("Installed LX plugin integrity verification failed");
                if (selection === undefined) selection = hash;
                if (this.getMigratedId(hash) || result.some((candidate) => candidate.hash === hash)) continue;
                totalBytes += Buffer.byteLength(code);
                if (result.length >= 100 || totalBytes > MAX_TOTAL_SOURCE_BYTES) throw new Error("The installed LX source limit has been reached");
                const sourceUrl = typeof integrity.sourceUrl === "string" && integrity.sourceUrl.length <= 8192 ? integrity.sourceUrl : undefined;
                result.push({ code, hash, path: filePath, sourceUrl });
            } catch (error) {
                onFailure(filePath, error);
            }
        }
        if (this.state.selectedHash === undefined && selection !== undefined) {
            this.state.selectedHash = selection;
            await this.persist();
        }
        return result;
    }
}

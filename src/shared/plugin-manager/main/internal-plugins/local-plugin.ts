import { localPluginHash, localPluginName } from "@/common/constant";
import { Plugin } from "../plugin";
import { addFileScheme, parseLocalMusicItem, parseLocalMusicItemFolder, parseLocalMusicLyric } from "@/common/file-util";
import path from "path";
import url from "url";
import { randomUUID } from "crypto";
import { LOCAL_MEDIA_PROTOCOL, parseLocalMediaUrl } from "@shared/local-media/common";
import { assertPathAccess } from "@shared/ipc-security/main";
import { assertLocalSourceAccess, rememberLocalSource } from "./local-file-access";
import type { PluginCapability } from "../../rpc";

const localCollections = new Map<string, { items: IMusic.IMusicItem[]; revision: string; expiresAt: number }>();
const MAX_LOCAL_COLLECTION_ITEMS = 200_000;
const LOCAL_COLLECTION_TTL_MS = 5 * 60 * 1000;

async function readLocalCollection(directory: string) {
    const items = await parseLocalMusicItemFolder(directory);
    if (items.length > MAX_LOCAL_COLLECTION_ITEMS) throw new Error("This folder contains too many songs to import");
    const snapshot = { items, revision: randomUUID(), expiresAt: Date.now() + LOCAL_COLLECTION_TTL_MS };
    localCollections.delete(directory);
    localCollections.set(directory, snapshot);
    let retainedItems = [...localCollections.values()].reduce((count, entry) => count + entry.items.length, 0);
    for (const [key, entry] of localCollections) {
        if (key !== directory && (entry.expiresAt <= Date.now() || retainedItems > MAX_LOCAL_COLLECTION_ITEMS || localCollections.size > 8)) {
            localCollections.delete(key);
            retainedItems -= entry.items.length;
        }
    }
    return snapshot;
}

function getLocalMusicFilePath(entity: IMusic.IMusicItemPartial) {
    const localPath = entity.localPath || entity.$$localPath;
    if (typeof localPath === "string" && localPath) return localPath;
    if (typeof entity.url === "string" && entity.url.startsWith("file:")) return url.fileURLToPath(entity.url);
    if (typeof entity.url === "string" && entity.url.startsWith(`${LOCAL_MEDIA_PROTOCOL}:`)) return parseLocalMediaUrl(entity.url);
    return null;
}

async function invokeLocal(capability: PluginCapability, value: unknown): Promise<unknown> {
    const request = value as { entity?: IMusic.IMusicItemPartial; url?: string; kind?: string; cursor?: unknown; limit?: unknown };
    const entity = request.entity ?? {};
    const localFilePath = getLocalMusicFilePath(entity);
    switch (capability) {
        case "media.resolve":
            if (!localFilePath) return null;
            return { url: addFileScheme(await assertLocalSourceAccess(localFilePath)) };
        case "lyrics.get":
            return { rawLrc: localFilePath ? await parseLocalMusicLyric(await assertLocalSourceAccess(localFilePath)) ?? entity.rawLrc : entity.rawLrc };
        case "entities.get": {
            if (!localFilePath) return null;
            const parsed = await parseLocalMusicItem(await assertLocalSourceAccess(localFilePath));
            return { ...parsed, artwork: entity.artwork, coverImg: parsed.artwork };
        }
        case "links.resolve": {
            if (typeof request.url !== "string") throw new Error("A local path is required");
            const rawPath = request.url.startsWith("file:") ? url.fileURLToPath(request.url) : request.url;
            const sourcePath = assertPathAccess(rawPath);
            await rememberLocalSource(sourcePath, request.kind === "sheet");
            if (request.kind !== "sheet") return parseLocalMusicItem(sourcePath);
            const { items: musicList } = await readLocalCollection(sourcePath);
            return { id: sourcePath, platform: localPluginName, title: path.basename(path.resolve(sourcePath)) || localPluginName,
                artist: localPluginName, artwork: musicList.find((item) => item.artwork)?.artwork,
                worksNum: musicList.length };
        }
        case "collections.members": {
            if (typeof entity.id !== "string" || request.kind !== "music" || !Number.isInteger(request.limit)
                || Number(request.limit) < 1 || Number(request.limit) > 500
                || !(request.cursor === null || typeof request.cursor === "string" && /^(0|[1-9][0-9]*)$/.test(request.cursor))) {
                throw new Error("The local collection page is invalid");
            }
            const directory = await assertLocalSourceAccess(entity.id, true);
            let snapshot = localCollections.get(directory);
            if (!snapshot || snapshot.expiresAt <= Date.now()) {
                if (request.cursor !== null) throw new Error("The local folder changed; retry the import");
                snapshot = await readLocalCollection(directory);
            }
            const offset = request.cursor === null ? 0 : Number(request.cursor);
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > snapshot.items.length) throw new Error("The local collection cursor is invalid");
            const end = Math.min(offset + Number(request.limit), snapshot.items.length);
            return { items: snapshot.items.slice(offset, end), total: snapshot.items.length,
                revision: snapshot.revision, nextCursor: end < snapshot.items.length ? String(end) : null };
        }
        default: throw new Error(`Local music does not support ${capability}`);
    }
}

const localPlugin = new Plugin({
    id: localPluginHash,
    manifest: { apiVersion: 2, id: localPluginHash, kind: "provider", name: localPluginName,
        version: "2.0.0", author: "BakaMusic", capabilities: ["media.resolve", "lyrics.get", "entities.get", "links.resolve", "collections.members"] },
}, "", invokeLocal);
export default localPlugin;

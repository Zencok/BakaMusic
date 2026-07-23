import { net, protocol } from "electron";
import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { supportLocalMediaType } from "@/common/constant";
import { assertPathAccess } from "@shared/ipc-security/main";
import {
    LOCAL_MEDIA_PROTOCOL,
    parseLocalMediaUrl,
    resolveLocalMediaByteRange,
} from "./common";
import {
    cleanupLocalMediaPlaybackCache,
    resolveLocalMediaPlaybackFile,
} from "./alac-transcoder";
import logger from "@shared/logger/main";

const localMediaContentTypes: Readonly<Record<string, string>> = {
    ".ac3": "audio/ac3",
    ".ac4": "audio/ac4",
    ".aac": "audio/aac",
    ".acc": "audio/aac",
    ".dts": "audio/vnd.dts",
    ".dtshd": "audio/vnd.dts.hd",
    ".eac3": "audio/eac3",
    ".ec3": "audio/eac3",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".m4s": "video/iso.segment",
    ".mka": "audio/x-matroska",
    ".mlp": "audio/vnd.dolby.mlp",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
    ".truehd": "audio/vnd.dolby.mlp",
    ".wav": "audio/wav",
    ".wma": "audio/x-ms-wma",
};

let localMediaSchemeRegistered = false;
let localMediaMainSetup = false;

function responseHeaders(filePath: string, fileSize: number, modifiedAt: Date) {
    return new Headers({
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "private, no-cache",
        "Content-Length": String(fileSize),
        "Content-Type": localMediaContentTypes[path.extname(filePath).toLocaleLowerCase()]
            ?? "application/octet-stream",
        "Last-Modified": modifiedAt.toUTCString(),
    });
}

async function handleLocalMediaRequest(request: Request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed", {
            status: 405,
            headers: { Allow: "GET, HEAD" },
        });
    }

    let requestedPath: string;
    try {
        requestedPath = parseLocalMediaUrl(request.url);
    } catch {
        return new Response("Local media request rejected", { status: 400 });
    }

    let filePath: string;
    try {
        const grantedPath = assertPathAccess(requestedPath, {
            extensions: supportLocalMediaType,
        });
        filePath = await fs.realpath(grantedPath);
        assertPathAccess(filePath, { extensions: supportLocalMediaType });
    } catch {
        return new Response("Local media path rejected", { status: 403 });
    }

    let fileStat;
    try {
        fileStat = await fs.stat(filePath);
        if (!fileStat.isFile()) {
            return new Response("Local media file not found", { status: 404 });
        }
    } catch {
        return new Response("Local media file not found", { status: 404 });
    }

    try {
        const playbackFile = await resolveLocalMediaPlaybackFile(filePath, fileStat);
        filePath = playbackFile.filePath;
        fileStat = playbackFile.fileStat;
    } catch (error) {
        logger.logError(
            "Failed to prepare local media playback file",
            error instanceof Error ? error : new Error(String(error)),
            { requestedPath },
        );
        return new Response("Local media preparation failed", { status: 500 });
    }

    let byteRange;
    try {
        byteRange = resolveLocalMediaByteRange(
            request.headers.get("range"),
            fileStat.size,
        );
    } catch {
        return new Response(null, {
            status: 416,
            headers: {
                "Accept-Ranges": "bytes",
                "Content-Range": `bytes */${fileStat.size}`,
            },
        });
    }

    const headers = responseHeaders(filePath, fileStat.size, fileStat.mtime);
    if (byteRange) {
        headers.set("Content-Length", String(byteRange.end - byteRange.start + 1));
        headers.set(
            "Content-Range",
            `bytes ${byteRange.start}-${byteRange.end}/${fileStat.size}`,
        );
    }
    const status = byteRange ? 206 : 200;
    if (request.method === "HEAD") {
        return new Response(null, { status, headers });
    }

    try {
        const upstreamHeaders = new Headers();
        if (byteRange) {
            upstreamHeaders.set(
                "Range",
                `bytes=${byteRange.start}-${byteRange.end}`,
            );
        }
        const upstream = await net.fetch(pathToFileURL(filePath).toString(), {
            headers: upstreamHeaders,
            signal: request.signal,
        });
        if (!upstream.ok) {
            return new Response("Local media read failed", { status: 502 });
        }
        return new Response(upstream.body, { status, headers });
    } catch {
        return new Response("Local media read failed", { status: 500 });
    }
}

export function registerLocalMediaProtocolScheme() {
    if (localMediaSchemeRegistered) {
        return;
    }
    localMediaSchemeRegistered = true;
    protocol.registerSchemesAsPrivileged([{
        scheme: LOCAL_MEDIA_PROTOCOL,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    }]);
}

export function setupLocalMediaMain() {
    if (localMediaMainSetup) {
        return;
    }
    localMediaMainSetup = true;
    protocol.handle(LOCAL_MEDIA_PROTOCOL, handleLocalMediaRequest);
    void cleanupLocalMediaPlaybackCache().catch((error) => {
        logger.logError(
            "Failed to clean local media playback cache",
            error instanceof Error ? error : new Error(String(error)),
        );
    });
}

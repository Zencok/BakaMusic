import { app, ipcMain } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import {
    assertFiniteNumber, assertIpcPayload, assertIpcSender, assertPathAccess,
    assertPlainObject, assertString, assertUrl,
} from "@shared/ipc-security/main";
import { supportLocalMediaType } from "@/common/constant";
import { parseLocalMediaUrl } from "@shared/local-media/common";
import { audioMime, isLanAddress, type DlnaCommand, type DlnaDevice, type DlnaLoadRequest } from "./common";
import { discoverDevices, disposeDlnaClient, type DiscoveredDevice } from "./client";
import { DlnaMediaServer } from "./media-server";
import { DlnaSession, type DlnaSource } from "./session";

const devices = new Map<string, DiscoveredDevice>();
let discovery: Promise<DlnaDevice[]> | null = null;
let discoveryTime = 0;

function validateCommand(value: unknown): asserts value is DlnaCommand {
    assertIpcPayload(value, 32 * 1024);
    assertPlainObject(value, "DLNA command");
    assertString(value.operation, "operation", 16);
    if (value.operation === "load") {
        assertPlainObject(value.request, "request");
        const request = value.request;
        assertString(request.deviceId, "deviceId", 64);
        assertString(request.sourceId, "sourceId", 128);
        assertString(request.url, "url", 8192);
        for (const name of ["title", "artist", "album"]) {
            assertString(request[name], name, 1024, true);
        }
        if (request.headers !== undefined) {
            assertPlainObject(request.headers, "headers");
            if (Object.keys(request.headers).length > 32) {
                throw new Error("Too many DLNA source headers");
            }
            for (const [name, header] of Object.entries(request.headers)) {
                assertString(name, "header name", 128);
                assertString(header, "header value", 4096, true);
            }
        }
        if (request.userAgent !== undefined) {
            assertString(request.userAgent, "userAgent", 1024, true);
        }
        return;
    }
    if (!["play", "pause", "stop", "status", "seek", "volume"].includes(value.operation)) {
        throw new Error("Unsupported DLNA command");
    }
    assertString(value.sourceId, "sourceId", 128);
    if (value.operation === "seek" || value.operation === "volume") {
        assertFiniteNumber(value.value, "value", 0, value.operation === "volume" ? 1 : 86400 * 7);
    }
}

async function resolveSource(request: DlnaLoadRequest, device: DiscoveredDevice): Promise<DlnaSource> {
    const parsed = new URL(request.url);
    if (parsed.protocol === "file:" || parsed.protocol === "bakamusic-media:") {
        const filePath = assertPathAccess(parsed.protocol === "file:"
            ? fileURLToPath(parsed) : parseLocalMediaUrl(request.url), { extensions: supportLocalMediaType });
        const mime = audioMime(pathToFileURL(filePath).toString());
        const server = await DlnaMediaServer.create(filePath, mime, device.localAddress, device.address);
        return { ...server, mime };
    }
    assertUrl(request.url, ["http:", "https:"]);
    if (request.userAgent || Object.keys(request.headers ?? {}).length) {
        throw new Error("DLNA_SOURCE_HEADERS_UNSUPPORTED");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
        lookup(parsed.hostname.replace(/^\[|\]$/g, ""), { all: true }),
        new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("DLNA source DNS timed out")), 4000);
            timer.unref();
        }),
    ]).finally(() => clearTimeout(timer));
    if (!addresses.length || addresses.some(({ address }) =>
        isIP(address) === 6 ? !/^[23][0-9a-f]{3}:/i.test(address)
            : isIP(address) !== 4 || isLanAddress(address) || address.startsWith("127.")
                || address.startsWith("0.") || Number(address.split(".")[0]) >= 224,
    )) {
        throw new Error("DLNA_SOURCE_LOCAL_PROXY_UNSUPPORTED");
    }
    return { url: parsed.toString(), mime: audioMime(parsed.toString()) };
}

export function setupDlnaMain() {
    const session = new DlnaSession(devices, resolveSource);
    let ownerId: number | null = null;
    ipcMain.handle("@shared/dlna/discover", (event) => {
        assertIpcSender(event, ["main"]);
        if (!discovery || Date.now() - discoveryTime > 10_000) {
            discoveryTime = Date.now();
            discovery = discoverDevices().then((found) => {
                devices.clear();
                for (const device of found) {
                    devices.set(device.id, device);
                }
                return found.map(({ id, name, address, volumeSupported }) => ({ id, name, address, volumeSupported }));
            }).catch((error) => {
                discovery = null;
                throw error;
            });
        }
        return discovery;
    });
    ipcMain.handle("@shared/dlna/command", (event, command: unknown) => {
        assertIpcSender(event, ["main"]);
        validateCommand(command);
        if (ownerId !== event.sender.id) {
            ownerId = event.sender.id;
            event.sender.once("destroyed", () => {
                ownerId = null;
                session.dispose();
            });
            event.sender.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
                if (isMainFrame && !isInPlace) {
                    session.dispose();
                }
            });
        }
        return session.command(command);
    });
    app.once("before-quit", () => {
        session.dispose();
        disposeDlnaClient();
    });
}

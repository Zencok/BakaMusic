import {
    app,
    BrowserWindow,
    IpcMainEvent,
    IpcMainInvokeEvent,
} from "electron";
import fs from "fs";
import path from "path";
import type { IWindowManager } from "@/types/window-manager";

export type WindowRole = "main" | "lyric" | "minimode";
export type IpcEvent = IpcMainEvent | IpcMainInvokeEvent;

const DEFAULT_IPC_PAYLOAD_LIMIT = 4 * 1024 * 1024;
const MAX_NESTING_DEPTH = 24;

interface PathGrant {
    path: string;
    recursive: boolean;
}

let windowManager: IWindowManager | null = null;
const pathGrants = new Map<string, PathGrant>();
type AppPathName = Parameters<typeof app.getPath>[0];

function normalizeCase(filePath: string) {
    return process.platform === "win32"
        ? filePath.toLocaleLowerCase("en-US")
        : filePath;
}

function normalizePath(filePath: string) {
    return normalizeCase(path.resolve(filePath));
}

function isWithinPath(candidate: string, root: string) {
    const relative = path.relative(root, candidate);
    return relative === "" || (
        relative !== ".."
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative)
    );
}

function resolveRealPath(filePath: string, allowMissing: boolean) {
    const resolved = path.resolve(filePath);
    try {
        return normalizeCase(fs.realpathSync.native(resolved));
    } catch (error) {
        if (!allowMissing) {
            throw error;
        }
        let existingAncestor = resolved;
        while (true) {
            const parent = path.dirname(existingAncestor);
            if (parent === existingAncestor) {
                return normalizePath(resolved);
            }
            existingAncestor = parent;
            try {
                const realAncestor = normalizeCase(
                    fs.realpathSync.native(existingAncestor),
                );
                return normalizePath(path.resolve(
                    realAncestor,
                    path.relative(existingAncestor, resolved),
                ));
            } catch {
                // Walk to the nearest existing ancestor so an intermediate
                // directory symlink cannot redirect a newly-created path.
            }
        }
    }
}

function getBuiltinPathRoots() {
    const pathNames: AppPathName[] = [
        "userData",
        "temp",
    ];
    const roots: string[] = [];
    for (const pathName of pathNames) {
        try {
            roots.push(resolveRealPath(app.getPath(pathName), true));
        } catch {
            // Some platform-specific paths may not exist.
        }
    }
    return roots;
}

function getWindowRole(event: IpcEvent): WindowRole | null {
    if (!windowManager || event.sender.isDestroyed()) {
        return null;
    }
    const senderId = event.sender.id;
    if (windowManager.mainWindow?.webContents.id === senderId) {
        return "main";
    }
    if (windowManager.lyricWindow?.webContents.id === senderId) {
        return "lyric";
    }
    if (windowManager.miniModeWindow?.webContents.id === senderId) {
        return "minimode";
    }
    return null;
}

function estimatePayloadBytes(value: unknown, depth = 0, seen = new WeakSet<object>()): number {
    if (depth > MAX_NESTING_DEPTH) {
        throw new Error("IPC payload nesting exceeds the limit");
    }
    if (value == null) {
        return 4;
    }
    if (typeof value === "string") {
        return Buffer.byteLength(value, "utf8");
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return 8;
    }
    if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
        throw new Error("IPC payload contains an unsupported value");
    }
    if (ArrayBuffer.isView(value)) {
        return value.byteLength;
    }
    if (value instanceof ArrayBuffer) {
        return value.byteLength;
    }
    if (typeof value === "object") {
        if (seen.has(value)) {
            throw new Error("IPC payload contains a cycle");
        }
        seen.add(value);
        let total = 0;
        if (Array.isArray(value)) {
            for (const item of value) {
                total += estimatePayloadBytes(item, depth + 1, seen);
            }
        } else {
            for (const [key, item] of Object.entries(value)) {
                total += Buffer.byteLength(key, "utf8");
                total += estimatePayloadBytes(item, depth + 1, seen);
            }
        }
        seen.delete(value);
        return total;
    }
    return 0;
}

export function setupIpcSecurity(manager: IWindowManager) {
    windowManager = manager;
}

export function assertIpcSender(
    event: IpcEvent,
    allowedRoles: readonly WindowRole[],
): WindowRole {
    const role = getWindowRole(event);
    if (!role || !allowedRoles.includes(role)) {
        throw new Error("IPC sender is not trusted for this channel");
    }
    const senderFrame = event.senderFrame;
    if (!senderFrame || senderFrame !== event.sender.mainFrame) {
        throw new Error("IPC calls from subframes are not accepted");
    }
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner || owner.isDestroyed()) {
        throw new Error("IPC sender window is unavailable");
    }
    return role;
}

export function isIpcSenderAllowed(
    event: IpcEvent,
    allowedRoles: readonly WindowRole[],
) {
    try {
        assertIpcSender(event, allowedRoles);
        return true;
    } catch {
        return false;
    }
}

export function assertIpcPayload(
    value: unknown,
    maxBytes = DEFAULT_IPC_PAYLOAD_LIMIT,
) {
    if (estimatePayloadBytes(value) > maxBytes) {
        throw new Error(`IPC payload exceeds ${maxBytes} bytes`);
    }
}

export function assertString(
    value: unknown,
    name: string,
    maxLength = 4096,
    allowEmpty = false,
): asserts value is string {
    if (
        typeof value !== "string"
        || value.length > maxLength
        || (!allowEmpty && value.trim().length === 0)
    ) {
        throw new Error(`${name} is not a valid string`);
    }
}

export function assertBoolean(value: unknown, name: string): asserts value is boolean {
    if (typeof value !== "boolean") {
        throw new Error(`${name} is not a boolean`);
    }
}

export function assertFiniteNumber(
    value: unknown,
    name: string,
    minimum: number,
    maximum: number,
): asserts value is number {
    if (
        typeof value !== "number"
        || !Number.isFinite(value)
        || value < minimum
        || value > maximum
    ) {
        throw new Error(`${name} is outside the accepted range`);
    }
}

export function assertPlainObject(
    value: unknown,
    name: string,
): asserts value is Record<string, unknown> {
    if (
        !value
        || typeof value !== "object"
        || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype
    ) {
        throw new Error(`${name} is not a plain object`);
    }
}

export function assertUrl(
    value: unknown,
    protocols: readonly string[] = ["https:"],
    maxLength = 8192,
    options: { allowCredentials?: boolean } = {},
) {
    assertString(value, "url", maxLength);
    const parsed = new URL(value);
    if (
        !protocols.includes(parsed.protocol)
        || !parsed.hostname
        || (!options.allowCredentials && (parsed.username || parsed.password))
    ) {
        throw new Error("URL protocol or authority is not accepted");
    }
    return parsed;
}

export function grantPathAccess(filePath: string, recursive = false) {
    assertString(filePath, "path", 32768);
    const normalized = resolveRealPath(filePath, true);
    pathGrants.set(`${recursive ? "r" : "f"}:${normalized}`, {
        path: normalized,
        recursive,
    });
}

export function revokePathAccess(filePath: string) {
    const normalized = resolveRealPath(filePath, true);
    pathGrants.delete(`r:${normalized}`);
    pathGrants.delete(`f:${normalized}`);
}

export function assertPathAccess(
    filePath: unknown,
    options: {
        allowMissing?: boolean;
        extensions?: readonly string[];
        extraRoots?: readonly string[];
    } = {},
) {
    assertString(filePath, "path", 32768);
    if (filePath.includes("\0")) {
        throw new Error("Path contains a null byte");
    }
    const resolved = resolveRealPath(filePath, options.allowMissing ?? false);
    const extensions = options.extensions?.map((extension) => extension.toLocaleLowerCase());
    if (extensions?.length && !extensions.includes(path.extname(resolved).toLocaleLowerCase())) {
        throw new Error("Path extension is not accepted");
    }

    const recursiveRoots = [
        ...getBuiltinPathRoots(),
        ...(options.extraRoots ?? []).map((root) => resolveRealPath(root, true)),
        ...[...pathGrants.values()]
            .filter((grant) => grant.recursive)
            .map((grant) => grant.path),
    ];
    const exactPaths = [...pathGrants.values()]
        .filter((grant) => !grant.recursive)
        .map((grant) => grant.path);
    if (
        !exactPaths.includes(resolved)
        && !recursiveRoots.some((root) => isWithinPath(resolved, root))
    ) {
        throw new Error("Path is outside the granted roots");
    }
    return path.resolve(filePath);
}

export function clearPathGrants() {
    pathGrants.clear();
}

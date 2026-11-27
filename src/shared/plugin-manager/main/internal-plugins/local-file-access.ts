import { app } from "electron";
import fs from "fs/promises";
import path from "path";
import { assertPathAccess, grantPathAccess } from "@shared/ipc-security/main";
import { supportLocalMediaType } from "@/common/constant";

interface SourceAuthorization { path: string; realPath: string; recursive: boolean }
const MAX_AUTHORIZATION_BYTES = 4 * 1024 * 1024;
const MAX_AUTHORIZATIONS = 10_000;
let authorizations: SourceAuthorization[] | null = null;
let writeQueue = Promise.resolve();
const authorizationPath = () => path.join(app.getPath("userData"), "local-source-authorizations.json");
const identity = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
function within(candidate: string, root: string) {
    const relative = path.relative(root, candidate);
    return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function readAuthorizations() {
    if (authorizations) return authorizations;
    try {
        const stat = await fs.stat(authorizationPath());
        if (!stat.isFile() || stat.size > MAX_AUTHORIZATION_BYTES) throw new Error("Source authorization file exceeds its limit");
        const parsed: unknown = JSON.parse(await fs.readFile(authorizationPath(), "utf8"));
        authorizations = Array.isArray(parsed) ? parsed.filter((item): item is SourceAuthorization =>
            !!item && typeof item === "object" && typeof item.path === "string" && path.isAbsolute(item.path)
            && typeof item.realPath === "string" && path.isAbsolute(item.realPath)
            && item.path.length <= 32768 && item.realPath.length <= 32768 && typeof item.recursive === "boolean").slice(-MAX_AUTHORIZATIONS) : [];
    } catch {
        authorizations = [];
    }
    return authorizations;
}

/** Persist only a source which an existing picker/configuration grant already authorizes. */
export async function rememberLocalSource(sourcePath: string, recursive: boolean) {
    const approvedPath = assertPathAccess(sourcePath, recursive ? {} : { extensions: supportLocalMediaType });
    const realPath = await fs.realpath(approvedPath);
    const stat = await fs.stat(realPath);
    if (recursive ? !stat.isDirectory() : !stat.isFile()) throw new Error("The selected local source is unavailable");
    const approved: SourceAuthorization = { path: path.resolve(approvedPath), realPath, recursive };
    const write = async () => {
        const records = await readAuthorizations();
        const next = records.filter((item) => identity(item.path) !== identity(approved.path) || item.recursive !== recursive).concat(approved).slice(-MAX_AUTHORIZATIONS);
        const snapshot = JSON.stringify(next);
        if (Buffer.byteLength(snapshot) > MAX_AUTHORIZATION_BYTES) throw new Error("Too many local sources are authorized");
        const filePath = authorizationPath();
        const temporary = `${filePath}.${process.pid}.tmp`;
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(temporary, snapshot, "utf8");
            await fs.rename(temporary, filePath);
            authorizations = next;
        } finally {
            await fs.rm(temporary, { force: true }).catch(() => undefined);
        }
    };
    writeQueue = writeQueue.then(write, write);
    await writeQueue;
}

/** Renderer fields never mint a file grant: restore only recorded, unchanged real-path identities. */
export async function assertLocalSourceAccess(sourcePath: string, directory = false) {
    try {
        return assertPathAccess(sourcePath, directory ? {} : { extensions: supportLocalMediaType });
    } catch (initialError) {
        const currentRealPath = await fs.realpath(sourcePath);
        for (const record of await readAuthorizations()) {
            if (directory && !record.recursive) continue;
            const currentRoot = await fs.realpath(record.path).catch(() => null);
            if (!currentRoot || identity(currentRoot) !== identity(record.realPath)) continue;
            if (!(record.recursive ? within(identity(currentRealPath), identity(record.realPath)) : identity(currentRealPath) === identity(record.realPath))) continue;
            grantPathAccess(currentRealPath, directory);
            return assertPathAccess(currentRealPath, directory ? {} : { extensions: supportLocalMediaType });
        }
        throw initialError;
    }
}

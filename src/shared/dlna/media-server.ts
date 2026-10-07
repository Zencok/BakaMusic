import { open, type FileHandle } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { resolveLocalMediaByteRange } from "../local-media/common";

export class DlnaMediaServer {
    private readonly token = randomBytes(24).toString("hex");
    private server: Server;
    private activeRequests = 0;
    private closed = false;
    private readonly expiry: ReturnType<typeof setTimeout>;

    private constructor(private file: FileHandle, private size: number, private mime: string, private remoteAddress: string) {
        this.server = createServer((request, response) => {
            if (this.closed || request.socket.remoteAddress !== this.remoteAddress
                || request.url !== "/" + this.token) {
                response.writeHead(404).end();
                return;
            }
            if (request.method !== "GET" && request.method !== "HEAD") {
                response.writeHead(405, { Allow: "GET, HEAD" }).end();
                return;
            }
            if (this.activeRequests >= 8) {
                response.writeHead(503).end();
                return;
            }
            let range;
            try {
                range = resolveLocalMediaByteRange(request.headers.range ?? null, this.size);
            } catch {
                response.writeHead(416, { "Content-Range": "bytes */" + this.size }).end();
                return;
            }
            response.writeHead(range ? 206 : 200, {
                "Content-Type": this.mime,
                "Accept-Ranges": "bytes",
                "Content-Length": range ? range.end - range.start + 1 : this.size,
                "transferMode.dlna.org": "Streaming",
                "contentFeatures.dlna.org": "DLNA.ORG_OP=01;DLNA.ORG_CI=0",
                ...(range ? { "Content-Range": "bytes " + range.start + "-" + range.end + "/" + this.size } : {}),
            });
            if (request.method === "HEAD" || !this.size) {
                response.end();
                return;
            }
            this.activeRequests += 1;
            const stream = Readable.from(this.readRange(range?.start ?? 0, range?.end ?? this.size - 1));
            stream.on("error", () => response.destroy());
            response.on("close", () => {
                this.activeRequests -= 1;
                stream.destroy();
            });
            stream.pipe(response);
        });
        this.server.requestTimeout = 15_000;
        this.server.headersTimeout = 10_000;
        this.server.maxConnections = 12;
        this.server.on("error", () => this.close());
        this.expiry = setTimeout(() => this.close(), 24 * 60 * 60 * 1000);
        this.expiry.unref();
    }

    private async *readRange(start: number, end: number) {
        let position = start;
        while (!this.closed && position <= end) {
            const buffer = Buffer.alloc(Math.min(64 * 1024, end - position + 1));
            const { bytesRead } = await this.file.read(buffer, 0, buffer.length, position);
            if (!bytesRead) {
                return;
            }
            position += bytesRead;
            yield buffer.subarray(0, bytesRead);
        }
    }

    static async create(filePath: string, mime: string, localAddress: string, remoteAddress: string) {
        const file = await open(filePath, "r");
        try {
            const stat = await file.stat();
            if (!stat.isFile()) {
                throw new Error("DLNA media must be a regular file");
            }
            const media = new DlnaMediaServer(file, stat.size, mime, remoteAddress);
            try {
                await new Promise<void>((resolve, reject) => {
                    media.server.once("error", reject);
                    media.server.listen(0, localAddress, () => {
                        media.server.removeListener("error", reject);
                        resolve();
                    });
                });
                const address = media.server.address();
                if (!address || typeof address === "string") {
                    throw new Error("DLNA media server has no listening address");
                }
                return { media, url: "http://" + localAddress + ":" + address.port + "/" + media.token };
            } catch (error) {
                media.close();
                throw error;
            }
        } catch (error) {
            await file.close().catch(() => undefined);
            throw error;
        }
    }

    close() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        clearTimeout(this.expiry);
        this.server.close();
        this.server.closeAllConnections();
        void this.file.close().catch(() => undefined);
    }
}

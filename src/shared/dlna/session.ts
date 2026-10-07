import type { DlnaCommand, DlnaLoadRequest, DlnaSnapshot } from "./common";
import { audioMime, buildMetadata, formatDlnaTime, parseDlnaTime } from "./common";
import { soap, xmlValue, type DiscoveredDevice } from "./client";
import type { DlnaMediaServer } from "./media-server";

export interface DlnaSource {
    url: string;
    mime: string;
    media?: DlnaMediaServer;
}

export class DlnaSession {
    private active: { device: DiscoveredDevice; sourceId: string; media?: DlnaMediaServer } | null = null;
    private queue: Promise<unknown> = Promise.resolve();
    private pending = 0;
    private epoch = 0;

    constructor(
        private devices: Map<string, DiscoveredDevice>,
        private resolveSource: (request: DlnaLoadRequest, device: DiscoveredDevice) => Promise<DlnaSource>,
        private control = soap,
    ) {}

    command(command: DlnaCommand): Promise<DlnaSnapshot | null> {
        if (this.pending >= 16) {
            return Promise.reject(new Error("DLNA command queue is full"));
        }
        this.pending += 1;
        const epoch = this.epoch;
        const deadline = Date.now() + 20_000;
        const result = this.queue.catch(() => undefined).then(async () => {
            if (epoch !== this.epoch || Date.now() > deadline) {
                throw new Error("DLNA command expired");
            }
            return this.execute(command, epoch);
        }).finally(() => {
            this.pending -= 1;
        });
        this.queue = result;
        return result;
    }

    private async execute(command: DlnaCommand, epoch: number): Promise<DlnaSnapshot | null> {
        if (command.operation === "load") {
            const request = command.request;
            const device = this.devices.get(request.deviceId);
            if (!device) {
                throw new Error("DLNA device is no longer available; refresh discovery");
            }
            await this.stopActive().catch(() => undefined);
            const source = await this.resolveSource(request, device);
            let uriRequested = false;
            try {
                if (epoch !== this.epoch) {
                    throw new Error("DLNA session was cancelled");
                }
                await this.control(device, "Stop", {}).catch(() => undefined);
                if (epoch !== this.epoch) {
                    throw new Error("DLNA session was cancelled");
                }
                uriRequested = true;
                await this.control(device, "SetAVTransportURI", {
                    CurrentURI: source.url,
                    CurrentURIMetaData: buildMetadata(request, source.url, source.mime || audioMime(source.url)),
                });
                if (epoch !== this.epoch) {
                    throw new Error("DLNA session was cancelled");
                }
                this.active = { device, sourceId: request.sourceId, media: source.media };
            } catch (error) {
                source.media?.close();
                if (uriRequested) {
                    await this.control(device, "Stop", {}).catch(() => undefined);
                }
                throw error;
            }
            return null;
        }
        const active = this.active;
        if (!active || active.sourceId !== command.sourceId) {
            return null;
        }
        const device = active.device;
        switch (command.operation) {
            case "play":
                await this.control(device, "Play", { Speed: "1" });
                break;
            case "pause":
                await this.control(device, "Pause", {});
                break;
            case "stop":
                await this.stopActive();
                break;
            case "seek":
                await this.control(device, "Seek", { Unit: "REL_TIME", Target: formatDlnaTime(command.value) });
                break;
            case "volume":
                if (device.rendering) {
                    await this.control(device, "SetVolume", { Channel: "Master", DesiredVolume: String(Math.round(command.value * 100)) }, true);
                }
                break;
            case "status": {
                const transport = await this.control(device, "GetTransportInfo", {});
                const state = xmlValue(transport, "CurrentTransportState").trim();
                const status = xmlValue(transport, "CurrentTransportStatus").trim();
                if (!["PLAYING", "PAUSED_PLAYBACK", "TRANSITIONING", "STOPPED", "NO_MEDIA_PRESENT"].includes(state)
                    || (status && status !== "OK")) {
                    throw new Error("DLNA device returned an invalid transport state");
                }
                const position = await this.control(device, "GetPositionInfo", {});
                return {
                    state,
                    currentTime: parseDlnaTime(xmlValue(position, "RelTime")),
                    duration: parseDlnaTime(xmlValue(position, "TrackDuration")),
                };
            }
        }
        return null;
    }

    private async stopActive() {
        const active = this.active;
        this.active = null;
        if (!active) {
            return;
        }
        active.media?.close();
        await this.control(active.device, "Stop", {});
    }

    dispose() {
        this.epoch += 1;
        const active = this.active;
        active?.media?.close();
        this.active = null;
        this.queue = this.queue.catch(() => undefined).then(async () => {
            if (active) {
                await this.control(active.device, "Stop", {}).catch(() => undefined);
            }
        });
    }
}

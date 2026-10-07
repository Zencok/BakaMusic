import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { Agent, request as httpRequest } from "node:http";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { escapeXml, isLanAddress, validateDeviceUrl, type DlnaDevice } from "./common";

const lanAgent = new Agent({ keepAlive: true, maxSockets: 8, maxTotalSockets: 32, timeout: 4000, proxyEnv: {} });

export function disposeDlnaClient() {
    lanAgent.destroy();
}

interface Service {
    type: string;
    url: string;
}

export interface DiscoveredDevice extends DlnaDevice {
    localAddress: string;
    transport: Service;
    rendering?: Service;
}

export function parseXml(text: string) {
    if (Buffer.byteLength(text) > 256 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text)) {
        throw new Error("DLNA XML exceeds limits or contains a forbidden declaration");
    }
    return load(text, { xml: true });
}

export function xmlValue(text: string, name: string) {
    const xml = parseXml(text);
    return xml("*").filter((_index, element) => element.type === "tag"
        && element.name.split(":").pop() === name).first().text();
}

export function requestXml(url: URL, method = "GET", body = "", headers: Record<string, string> = {}) {
    return new Promise<string>((resolve, reject) => {
        const request = httpRequest(url, { method, headers, agent: lanAgent }, (response) => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            response.on("data", (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > 256 * 1024) {
                    request.destroy(new Error("DLNA response exceeds the size limit"));
                    return;
                }
                chunks.push(chunk);
            });
            response.on("error", reject);
            response.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                if (response.statusCode !== 200) {
                    reject(new Error("DLNA HTTP " + response.statusCode));
                } else {
                    resolve(text);
                }
            });
        });
        const timeout = setTimeout(() => request.destroy(new Error("DLNA request timed out")), 4000);
        request.on("close", () => clearTimeout(timeout));
        request.on("error", reject);
        request.end(body);
    });
}

export function parseDescription(text: string, location: string, address: string, localAddress: string): DiscoveredDevice | null {
    const locationUrl = validateDeviceUrl(location, address);
    const xml = parseXml(text);
    const base = xml("URLBase").first().text().trim() || location;
    validateDeviceUrl(base, address, locationUrl.origin);
    const renderer = xml("device").filter((_index, element) =>
        /^urn:schemas-upnp-org:device:MediaRenderer:\d+$/.test(xml(element).children("deviceType").text().trim()),
    ).first();
    if (!renderer.length) {
        return null;
    }
    const services = renderer.children("serviceList").children("service");
    const getService = (name: string): Service | undefined => {
        const service = services.filter((_index, element) => new RegExp("^urn:schemas-upnp-org:service:" + name + ":\\d+$")
            .test(xml(element).children("serviceType").text().trim())).first();
        if (!service.length) {
            return undefined;
        }
        const url = new URL(service.children("controlURL").text().trim(), base).toString();
        validateDeviceUrl(url, address, locationUrl.origin);
        return { type: service.children("serviceType").text().trim(), url };
    };
    const transport = getService("AVTransport");
    if (!transport) {
        return null;
    }
    const rendering = getService("RenderingControl");
    return {
        id: createHash("sha256").update(location).digest("hex"),
        name: renderer.children("friendlyName").text().trim().slice(0, 256) || address,
        address,
        localAddress,
        transport,
        rendering,
        volumeSupported: !!rendering,
    };
}

export async function soap(device: DiscoveredDevice, action: string, args: Record<string, string>, rendering = false) {
    const service = rendering ? device.rendering : device.transport;
    if (!service) {
        throw new Error("DLNA device does not support volume control");
    }
    const url = validateDeviceUrl(service.url, device.address);
    const body = "<?xml version=\"1.0\" encoding=\"utf-8\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:"
        + action + " xmlns:u=\"" + escapeXml(service.type) + "\"><InstanceID>0</InstanceID>"
        + Object.entries(args).map(([key, value]) => "<" + key + ">" + escapeXml(value) + "</" + key + ">").join("")
        + "</u:" + action + "></s:Body></s:Envelope>";
    const response = await requestXml(url, "POST", body, {
        "Content-Type": "text/xml; charset=utf-8",
        "Content-Length": String(Buffer.byteLength(body)),
        SOAPAction: "\"" + service.type + "#" + action + "\"",
    });
    if (xmlValue(response, "Fault")) {
        throw new Error("DLNA device rejected the control action");
    }
    return response;
}

export function discoverDevices(): Promise<DiscoveredDevice[]> {
    const addresses = [...new Set(Object.values(networkInterfaces()).flatMap((interfaces) =>
        (interfaces ?? []).filter((entry) => entry.family === "IPv4" && !entry.internal && isLanAddress(entry.address))
            .map((entry) => entry.address),
    ))].slice(0, 8);
    return new Promise((resolve, reject) => {
        const devices = new Map<string, DiscoveredDevice>();
        const seen = new Set<string>();
        const sockets = addresses.map(() => createSocket("udp4"));
        let active = true;
        let successfulSockets = 0;
        const jobs: Promise<void>[] = [];
        const timer = setTimeout(() => {
            active = false;
            for (const socket of sockets) {
                try {
                    socket.close();
                } catch {
                    continue;
                }
            }
            void Promise.allSettled(jobs).then(() => {
                if (addresses.length && !successfulSockets) {
                    reject(new Error("DLNA discovery could not bind a LAN interface"));
                } else {
                    resolve([...devices.values()].sort((first, second) => first.name.localeCompare(second.name)));
                }
            });
        }, 3000);
        if (!addresses.length) {
            clearTimeout(timer);
            resolve([]);
        }
        sockets.forEach((socket, index) => {
            socket.on("error", () => undefined);
            socket.on("message", (message, sender) => {
                if (!active || message.length > 8192 || !isLanAddress(sender.address) || jobs.length >= 32) {
                    return;
                }
                const text = message.toString("utf8");
                if (!/^HTTP\/1\.[01] 200\b/.test(text)) {
                    return;
                }
                const location = /^location:\s*(.+)$/im.exec(text)?.[1].trim();
                if (!location || seen.has(location)) {
                    return;
                }
                try {
                    const url = validateDeviceUrl(location, sender.address);
                    seen.add(location);
                    jobs.push(requestXml(url).then((description) => {
                        const device = parseDescription(description, location, sender.address, addresses[index]);
                        if (device) {
                            devices.set(device.id, device);
                        }
                    }).catch(() => undefined));
                } catch {
                    return;
                }
            });
            socket.bind(0, addresses[index], () => {
                if (!active) {
                    return;
                }
                successfulSockets += 1;
                socket.setMulticastTTL(2);
                socket.setMulticastInterface(addresses[index]);
                const search = Buffer.from("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n");
                socket.send(search, 1900, "239.255.255.250", () => undefined);
            });
        });
    });
}

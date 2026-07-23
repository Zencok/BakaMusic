import { useCallback, useEffect, useState } from "react";
import nativePlayback from "@shared/native-playback/renderer";
import type { INativeAudioOutputDevice } from "@shared/native-playback/common";

/**
 * Shape stored in `playMusic.audioOutputDevice`.
 * Uses mpv device ids (`auto`, `wasapi/{guid}`, …), not Chromium sink ids.
 */
export type IOutputAudioDeviceOption = MediaDeviceInfo | {
    deviceId: string;
    label: string;
    kind: "audiooutput";
    groupId: string;
    toJSON: () => {
        deviceId: string;
        label: string;
        kind: "audiooutput";
        groupId: string;
    };
};

function createOutputDeviceOption(
    deviceId: string,
    label: string,
): IOutputAudioDeviceOption {
    const normalizedLabel = label || deviceId || "Default";
    const payload = {
        deviceId: deviceId || "auto",
        label: normalizedLabel,
        kind: "audiooutput" as const,
        groupId: "",
    };
    return {
        ...payload,
        toJSON: () => payload,
    };
}

function fromNativeDevices(devices: INativeAudioOutputDevice[]): IOutputAudioDeviceOption[] {
    if (!devices.length) {
        return [createOutputDeviceOption("auto", "Default")];
    }
    return devices.map((device) => createOutputDeviceOption(device.id, device.description));
}

function fromChromiumDevices(devices: MediaDeviceInfo[]): IOutputAudioDeviceOption[] {
    const outputs = devices.filter((item) => item.kind === "audiooutput");
    if (!outputs.length) {
        return [createOutputDeviceOption("auto", "Default")];
    }
    // Chromium sink ids are not usable by libmpv; still surface a Default entry
    // plus any labeled devices for older fallback paths.
    const mapped = outputs.map((item) =>
        createOutputDeviceOption(
            item.deviceId || "auto",
            item.label || item.deviceId || "Audio output",
        ),
    );
    if (!mapped.some((item) => item.deviceId === "auto" || item.deviceId === "default")) {
        mapped.unshift(createOutputDeviceOption("auto", "Default"));
    }
    return mapped;
}

/**
 * Audio output devices for settings / track player.
 * Prefer libmpv `audio-device-list` so WASAPI exclusive mode receives real device ids.
 */
export function useOutputAudioDevices(): IOutputAudioDeviceOption[] | null {
    const [devices, setDevices] = useState<IOutputAudioDeviceOption[] | null>(null);

    const refresh = useCallback(async () => {
        try {
            const nativeDevices = await nativePlayback.listAudioDevices();
            if (Array.isArray(nativeDevices) && nativeDevices.length > 0) {
                setDevices(fromNativeDevices(nativeDevices));
                return;
            }
        } catch {
            // Fall through to Chromium enumeration.
        }

        try {
            if (!navigator.mediaDevices?.enumerateDevices) {
                setDevices([createOutputDeviceOption("auto", "Default")]);
                return;
            }
            const mediaDevices = await navigator.mediaDevices.enumerateDevices();
            setDevices(fromChromiumDevices(mediaDevices));
        } catch {
            setDevices([createOutputDeviceOption("auto", "Default")]);
        }
    }, []);

    useEffect(() => {
        void refresh();

        const media = navigator.mediaDevices;
        if (!media) {
            return;
        }

        const onDeviceChange = () => {
            void refresh();
        };
        media.addEventListener?.("devicechange", onDeviceChange);
        // Older Chromium also supports the ondevicechange property.
        if (!media.addEventListener && "ondevicechange" in media) {
            media.ondevicechange = onDeviceChange;
        }
        return () => {
            media.removeEventListener?.("devicechange", onDeviceChange);
            if (!media.addEventListener && media.ondevicechange === onDeviceChange) {
                media.ondevicechange = null;
            }
        };
    }, [refresh]);

    return devices;
}

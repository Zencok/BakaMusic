import { useEffect, useState } from "react";

export function useOutputAudioDevices(): MediaDeviceInfo[] | null {
    const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);

    useEffect(() => {
        navigator.mediaDevices
            .enumerateDevices()
            .then((res) => {
                setDevices(res.filter((item) => item.kind === "audiooutput"));
            })
            .catch((): undefined => undefined);
    }, []);

    return devices;
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SvgAsset from "@renderer/components/SvgAsset";
import dlna from "@shared/dlna/renderer";
import type { DlnaDevice } from "@shared/dlna/common";
import trackPlayer from "@renderer/core/track-player";
import { dlnaDeviceStore } from "@renderer/core/track-player/dlna-store";
import Base from "../Base";
import "./index.scss";

export default function Dlna() {
    const { t } = useTranslation();
    const selected = dlnaDeviceStore.useValue();
    const [devices, setDevices] = useState<DlnaDevice[]>([]);
    const [scanning, setScanning] = useState(true);
    const [switching, setSwitching] = useState(false);
    const [error, setError] = useState<"scan_error" | "error" | null>(null);
    const generation = useRef(0);
    const mounted = useRef(false);
    const selecting = useRef(false);
    const localButton = useRef<HTMLButtonElement>(null);

    const refresh = useCallback(async () => {
        const request = ++generation.current;
        setScanning(true);
        setError((previous) => previous === "scan_error" ? null : previous);
        try {
            const found = await dlna.discover();
            if (mounted.current && request === generation.current) {
                setDevices(found);
            }
        } catch {
            if (mounted.current && request === generation.current) {
                setError("scan_error");
            }
        } finally {
            if (mounted.current && request === generation.current) {
                setScanning(false);
            }
        }
    }, []);

    useEffect(() => {
        mounted.current = true;
        void refresh();
        return () => {
            mounted.current = false;
        };
    }, [refresh]);

    const select = async (device: DlnaDevice | null) => {
        if (selecting.current || (selected?.id ?? null) === (device?.id ?? null)) {
            return;
        }
        selecting.current = true;
        setSwitching(true);
        setError(null);
        try {
            await trackPlayer.setDlnaDevice(device);
        } catch {
            if (mounted.current) {
                setError("error");
            }
        } finally {
            selecting.current = false;
            if (mounted.current) {
                setSwitching(false);
            }
        }
    };

    const outputs = selected && !devices.some((device) => device.id === selected.id)
        ? [selected, ...devices]
        : devices;

    return (
        <Base defaultClose initialFocusRef={localButton}>
            <section className="modal--dlna">
                <Base.Header>{t("dlna.title")}</Base.Header>
                <div className="dlna-body">
                    <ul className="dlna-outputs" aria-label={t("dlna.devices")} aria-busy={switching}>
                        <li>
                            <button ref={localButton} type="button" className="dlna-output"
                                disabled={switching} aria-pressed={!selected}
                                onClick={() => void select(null)}>
                                <SvgAsset iconName="computer"></SvgAsset>
                                <span className="dlna-output-copy">
                                    <span className="dlna-output-name">{t("dlna.local")}</span>
                                    <span className="dlna-output-description">{t("dlna.local_hint")}</span>
                                </span>
                                {!selected && <span className="dlna-selected"><SvgAsset iconName="check"></SvgAsset></span>}
                            </button>
                        </li>
                    </ul>
                    <div className="dlna-section-heading">
                        <span>{t("dlna.nearby")}</span>
                        <button type="button" className="dlna-refresh" disabled={scanning || switching}
                            title={t("dlna.refresh")} aria-label={t("dlna.refresh")}
                            onClick={() => void refresh()}>
                            <SvgAsset iconName="arrow-path"></SvgAsset>
                        </button>
                    </div>
                    <ul className="dlna-outputs" aria-label={t("dlna.nearby")} aria-busy={switching}>
                        {outputs.map((device) => (
                            <li key={device.id}>
                                <button type="button" className="dlna-output" disabled={switching}
                                    aria-pressed={selected?.id === device.id} onClick={() => void select(device)}>
                                    <SvgAsset iconName="audio-output"></SvgAsset>
                                    <span className="dlna-output-copy">
                                        <span className="dlna-output-name">{device.name}</span>
                                        <span className="dlna-output-description">{t("dlna.wireless")}</span>
                                    </span>
                                    {selected?.id === device.id && <span className="dlna-selected"><SvgAsset iconName="check"></SvgAsset></span>}
                                </button>
                            </li>
                        ))}
                    </ul>
                    <div className="dlna-status" role="status" aria-live="polite">
                        {switching ? t("dlna.busy") : scanning ? t("dlna.scanning") : !outputs.length ? t("dlna.empty") : null}
                    </div>
                    <p className="dlna-hint">{t("dlna.hint")}</p>
                    {error && <p className="dlna-error" role="alert">{t("dlna." + error)}</p>}
                </div>
            </section>
        </Base>
    );
}

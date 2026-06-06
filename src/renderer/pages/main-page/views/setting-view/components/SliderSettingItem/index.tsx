import "./index.scss";
import type { CSSProperties, ReactNode } from "react";
import { IAppConfig } from "@/types/app-config";
import useAppConfig from "@/hooks/useAppConfig";
import AppConfig from "@shared/app-config/renderer";

interface SliderSettingItemProps<T extends keyof IAppConfig> {
    keyPath: T;
    label?: string;
    min?: number;
    max?: number;
    step?: number | "any";
    renderValue?: (value: number) => ReactNode;
}

export default function SliderSettingItem<T extends keyof IAppConfig>(
    props: SliderSettingItemProps<T>,
) {
    const {
        keyPath,
        label,
        min = 0,
        max = 1,
        step = 0.05,
        renderValue,
    } = props;

    const rawValue = useAppConfig(keyPath);
    const numericValue = typeof rawValue === "number" ? rawValue : min;
    const clampedValue = Math.max(min, Math.min(max, numericValue));
    const percent = max > min ? ((clampedValue - min) / (max - min)) * 100 : 0;

    return (
        <div className="setting-view--slider-setting-item-container setting-row">
            <div className="label-container">{label}</div>
            <div className="slider-container">
                <input
                    className="slider-input"
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={clampedValue}
                    style={{ "--slider-percent": `${percent}%` } as CSSProperties}
                    onChange={(event) => {
                        AppConfig.setConfig({
                            [keyPath]: Number(event.target.value) as IAppConfig[T],
                        });
                    }}
                ></input>
                <div className="slider-value">
                    {renderValue ? renderValue(clampedValue) : clampedValue}
                </div>
            </div>
        </div>
    );
}

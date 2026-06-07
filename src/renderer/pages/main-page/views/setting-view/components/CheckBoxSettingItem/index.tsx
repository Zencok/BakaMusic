import SvgAsset from "@/renderer/components/SvgAsset";
import classNames from "@/renderer/utils/classnames";
import { IAppConfig } from "@/types/app-config";
import useAppConfig from "@/hooks/useAppConfig";
import AppConfig from "@shared/app-config/renderer";

interface ICheckBoxSettingItemProps<T extends keyof IAppConfig> {
    keyPath: T;
    label?: string;
    onChange?: (event: Event, checked: boolean) => void;
}

export default function CheckBoxSettingItem<T extends keyof IAppConfig>(
    props: ICheckBoxSettingItemProps<T>,
) {
    const {
        keyPath,
        label,
        onChange,
    } = props;

    const checked = useAppConfig(keyPath);

    return (
        <div className="setting-row setting-toggle-row">
            <div className="label-container">{label}</div>
            <button
                className={classNames({
                    "setting-toggle-control": true,
                    highlight: checked as boolean,
                })}
                title={label}
                type="button"
                aria-pressed={!!checked}
                onClick={() => {
                    const event = new Event("ConfigChanged", {
                        cancelable: true,
                    });
                    if (onChange) {
                        onChange(event, !checked);
                    }
                    if (!event.defaultPrevented) {
                        AppConfig.setConfig({
                            [keyPath]: !checked,
                        });
                    }
                }}
            >
                <span className="setting-toggle-thumb">
                    {checked ? <SvgAsset iconName="check"></SvgAsset> : null}
                </span>
            </button>
        </div>
    );
}

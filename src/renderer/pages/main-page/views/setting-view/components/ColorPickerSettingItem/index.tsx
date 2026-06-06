import { IAppConfig } from "@/types/app-config";
import ColorInputSettingItem from "../ColorInputSettingItem";

interface IColorPickerSettingItemProps<T extends keyof IAppConfig> {
    keyPath: T;
    label?: string;
}

export default function ColorPickerSettingItem<T extends keyof IAppConfig>(
    props: IColorPickerSettingItemProps<T>,
) {
    return (
        <ColorInputSettingItem
            keyPath={props.keyPath}
            label={props.label}
        ></ColorInputSettingItem>
    );
}

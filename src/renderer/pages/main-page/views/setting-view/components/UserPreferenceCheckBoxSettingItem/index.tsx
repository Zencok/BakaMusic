import SvgAsset from "@/renderer/components/SvgAsset";
import classNames from "@/renderer/utils/classnames";
import { useUserPreference } from "@/renderer/utils/user-perference";

type IUserPreferenceBooleanKey = {
    [K in keyof IUserPreference.IType]: IUserPreference.IType[K] extends boolean
        ? K
        : never;
}[keyof IUserPreference.IType];

interface IUserPreferenceCheckBoxSettingItemProps<
    T extends IUserPreferenceBooleanKey,
> {
    keyPath: T;
    label?: string;
    onChange?: (checked: boolean) => void;
}

export default function UserPreferenceCheckBoxSettingItem<
    T extends IUserPreferenceBooleanKey,
>(props: IUserPreferenceCheckBoxSettingItemProps<T>) {
    const {
        keyPath,
        label,
        onChange,
    } = props;

    const [checked, setChecked] = useUserPreference(keyPath);

    return (
        <div className="setting-row">
            <div
                className={classNames({
                    "option-item-container": true,
                    highlight: !!checked,
                })}
                title={label}
                role="button"
                onClick={() => {
                    const nextChecked = !checked;
                    onChange?.(!!nextChecked);
                    setChecked(nextChecked);
                }}
            >
                <div className="checkbox">
                    {checked ? <SvgAsset iconName="check"></SvgAsset> : null}
                </div>
                {label}
            </div>
        </div>
    );
}

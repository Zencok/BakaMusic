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
        <div className="setting-row setting-toggle-row">
            <div className="label-container">{label}</div>
            <button
                className={classNames({
                    "setting-toggle-control": true,
                    highlight: !!checked,
                })}
                title={label}
                type="button"
                aria-pressed={!!checked}
                onClick={() => {
                    const nextChecked = !checked;
                    onChange?.(!!nextChecked);
                    setChecked(nextChecked);
                }}
            >
                <span className="setting-toggle-thumb">
                    {checked ? <SvgAsset iconName="check"></SvgAsset> : null}
                </span>
            </button>
        </div>
    );
}

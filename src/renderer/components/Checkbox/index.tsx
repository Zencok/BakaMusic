import { CSSProperties } from "react";
import SvgAsset from "../SvgAsset";
import "./index.scss";

interface ICheckboxProps {
    checked?: boolean;
    onChange?: (newChecked: boolean) => void;
    style?: CSSProperties;
    ariaLabel?: string;
}

export default function Checkbox(props: ICheckboxProps) {
    const { checked, onChange, style } = props;

    if (!onChange) {
        return (
            <span className="checkbox-container" style={style} aria-hidden="true">
                {checked ? <SvgAsset iconName="check"></SvgAsset> : null}
            </span>
        );
    }

    return (
        <button
            type="button"
            className="checkbox-container"
            style={style}
            role="checkbox"
            aria-checked={!!checked}
            aria-label={props.ariaLabel}
            onClick={() => {
                onChange?.(!checked);
            }}
        >
            {checked ? <SvgAsset iconName="check"></SvgAsset> : null}
        </button>
    );
}

import SvgAsset, { SvgAssetIconNames } from "@/renderer/components/SvgAsset";
import "./index.scss";

interface IProps {
    selected?: boolean;
    onClick?: () => void;
    onContextMenu?: (...args: any) => void;
    iconName?: SvgAssetIconNames;
    title?: string;
}

export default function ListItem(props: IProps) {
    const { selected, onClick, iconName, title, onContextMenu } = props ?? {};
    return (
        <div
            onClick={onClick}
            onContextMenu={onContextMenu}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onClick?.();
                }
            }}
            title={title}
            role="button"
            tabIndex={0}
            aria-current={selected ? "page" : undefined}
            className="side-bar--list-item-container"
            data-selected={selected}
        >
            {iconName ? <SvgAsset iconName={iconName}></SvgAsset> : null}
            <span>{title ?? ""}</span>
        </div>
    );
}

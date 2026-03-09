import { ReactNode, useRef } from "react";
import "./index.scss";
import SvgAsset from "@/renderer/components/SvgAsset";
import { hidePanel } from "../..";

interface IBaseModalProps {
    onDefaultClick?: () => void;
    defaultClose?: boolean;
    withBlur?: boolean;
    maskColor?: string;
    title?: ReactNode;
    width?: string | number;
    scrollable?: boolean;
    children: ReactNode;
    coverHeader?: boolean;
}

const baseId = "components--panel-base-container";

function Base(props: IBaseModalProps) {
    const {
        onDefaultClick,
        defaultClose = true,
        maskColor,
        children,
        withBlur = false,
        width,
        scrollable = true,
        coverHeader = false,
    } = props;

    const trapCloseRef = useRef(false);

    return (
        <div
            id={baseId}
            className={`components--panel-base animate__animated animate__fadeIn ${
                withBlur ? "blur10" : ""
            }`}
            data-cover-header={coverHeader}
            style={{
                backgroundColor: maskColor,
            }}
            role="button"
            onMouseDown={(e) => {
                if ((e.target as HTMLElement)?.id === baseId) {
                    trapCloseRef.current = true;
                } else {
                    trapCloseRef.current = false;
                }
            }}
            onMouseUp={(e) => {
                if ((e.target as HTMLElement)?.id === baseId && trapCloseRef.current) {
                    if (defaultClose) {
                        hidePanel();
                    } else {
                        onDefaultClick?.();
                    }
                }
            }}
            onMouseLeave={() => {
                trapCloseRef.current = false;
            }}
            onMouseOut={() => {
                trapCloseRef.current = false;
            }}
        >
            <div
                className="components--panel-base-content animate__animated animate__slideInRight shadow"
                style={{
                    width,
                    overflowY: scrollable ? "auto" : "initial",
                }}
            >
                {children}
            </div>
        </div>
    );
}

interface IHeaderProps {
    children: ReactNode;
    right?: ReactNode;
}
function Header(props: IHeaderProps) {
    const { children, right } = props;

    return (
        <div className="components--panel-base-header">
            <div className="components--panel-base-header-main">{children}</div>
            <div className="components--panel-base-header-right">
                {right ?? (
                    <div
                        role="button"
                        className="components--panel-base-header-close opacity-button"
                        onClick={() => {
                            hidePanel();
                        }}
                    >
                        <SvgAsset iconName="x-mark"></SvgAsset>
                    </div>
                )}
            </div>
        </div>
    );
}

Base.Header = Header;
export default Base;

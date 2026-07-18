import { ReactNode, useEffect, useRef } from "react";
import "./index.scss";
import SvgAsset from "@/renderer/components/SvgAsset";
import { hidePanel } from "../..";
import { isModalOpen } from "@/renderer/components/Modal";
import { isQualitySelectPopoverOpen } from "@/renderer/components/QualitySelectPopover";
import { isContextMenuOpen } from "@/renderer/components/ContextMenu";
import { useTranslation } from "react-i18next";

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
    const { t } = useTranslation();

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Escape") {
                return;
            }
            // Popover / modal / context menu own Escape first
            if (
                isQualitySelectPopoverOpen()
                || isModalOpen()
                || isContextMenuOpen()
            ) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            if (defaultClose) {
                hidePanel();
            } else {
                onDefaultClick?.();
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [defaultClose, onDefaultClick]);

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
            role="presentation"
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
        >
            <div
                className="components--panel-base-content animate__animated animate__slideInRight shadow"
                role="dialog"
                aria-modal="true"
                aria-label={t("common.panel")}
                tabIndex={-1}
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
    const { t } = useTranslation();

    return (
        <div className="components--panel-base-header">
            <div className="components--panel-base-header-main">{children}</div>
            <div className="components--panel-base-header-right">
                {right ?? (
                    <button
                        type="button"
                        aria-label={t("common.close")}
                        className="components--panel-base-header-close opacity-button"
                        onClick={() => {
                            hidePanel();
                        }}
                    >
                        <SvgAsset iconName="x-mark"></SvgAsset>
                    </button>
                )}
            </div>
        </div>
    );
}

Base.Header = Header;
export default Base;

import { ReactNode, useEffect, useRef } from "react";
import { hideModal } from "../..";
import "./index.scss";
import SvgAsset from "@/renderer/components/SvgAsset";
import { isQualitySelectPopoverOpen } from "@/renderer/components/QualitySelectPopover";
import { isContextMenuOpen } from "@/renderer/components/ContextMenu";
import { useTranslation } from "react-i18next";
import { appWindowUtil } from "@shared/utils/renderer";

interface IBaseModalProps {
    onDefaultClick?: () => void;
    onRequestClose?: () => void;
    initialFocusRef?: { readonly current: HTMLElement | null };
    defaultClose?: boolean;
    withBlur?: boolean;
    animated?: boolean;
    children: ReactNode;
}

const baseId = "components--modal-base-container";

function Base(props: IBaseModalProps) {
    const {
        onDefaultClick,
        onRequestClose,
        initialFocusRef,
        defaultClose = false,
        children,
        withBlur = true,
        animated = true,
    } = props;

    const trapCloseRef = useRef(false);
    const dialogRef = useRef<HTMLDivElement>(null);
    const { t } = useTranslation();

    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const focusTimer = requestAnimationFrame(() => {
            const dialog = dialogRef.current;
            const initialFocus = initialFocusRef?.current;
            if (initialFocus && dialog?.contains(initialFocus) && !initialFocus.hasAttribute("disabled")) {
                initialFocus.focus();
                return;
            }
            const firstFocusable = dialog?.querySelector<HTMLElement>(
                "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), "
                + "textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
            );
            (firstFocusable ?? dialog)?.focus();
        });
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.code === "Tab") {
                const dialog = dialogRef.current;
                if (!dialog) {
                    return;
                }
                const focusable = [...dialog.querySelectorAll<HTMLElement>(
                    "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), "
                    + "textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
                )].filter((element) => !element.hidden && element.offsetParent !== null);
                if (!focusable.length) {
                    event.preventDefault();
                    dialog.focus();
                    return;
                }
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
                return;
            }
            if (event.code !== "Escape") {
                return;
            }
            // Let an open, modal-local flyout consume Escape before the dialog.
            if (dialogRef.current?.querySelector("[data-modal-layer-open='true']")) {
                return;
            }
            // Let media element fullscreen leave before considering modal
            // dismissal. The MV player owns a real Fullscreen API element, so
            // Escape is handled by Chromium first and the modal stays open.
            if (document.fullscreenElement) {
                return;
            }
            // Higher layers first
            if (isQualitySelectPopoverOpen() || isContextMenuOpen()) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            if (typeof appWindowUtil.isMainWindowFullScreen === "function") {
                void appWindowUtil.isMainWindowFullScreen().then((isFullscreen) => {
                    if (isFullscreen) {
                        appWindowUtil.setMainWindowFullScreen?.(false);
                        return;
                    }
                    if (onRequestClose) {
                        onRequestClose();
                    } else {
                        hideModal();
                        onDefaultClick?.();
                    }
                });
                return;
            }
            // Escape always dismisses the top modal (matches user expectation)
            if (onRequestClose) {
                onRequestClose();
            } else {
                hideModal();
                onDefaultClick?.();
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            cancelAnimationFrame(focusTimer);
            window.removeEventListener("keydown", onKeyDown, true);
            previousFocus?.focus();
        };
    }, [initialFocusRef, onDefaultClick, onRequestClose]);

    return (
        // The dialog itself owns pointer-based backdrop dismissal.
        // eslint-disable-next-line jsx-a11y-x/no-noninteractive-element-interactions
        <div
            id={baseId}
            className={`components--modal-base${
                animated ? " animate__animated animate__fadeIn" : ""
            }${
                withBlur ? " blur10" : ""
            }`}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("common.dialog")}
            tabIndex={-1}
            onMouseDown={(e) => {
                if ((e.target as HTMLElement)?.id === baseId) {
                    trapCloseRef.current = true;
                } else {
                    trapCloseRef.current = false;
                }
            }}
            onMouseUp={(e) => {
                if ((e.target as HTMLElement)?.id === baseId && trapCloseRef.current) {
                    if (onRequestClose) {
                        onRequestClose();
                    } else if (defaultClose) {
                        hideModal();
                    } else {
                        onDefaultClick?.();
                    }
                }
            }}
            onMouseLeave={() => {
                trapCloseRef.current = false;
            }}
        >
            {children}
        </div>
    );
}

interface IHeaderProps {
    children: ReactNode;
}
function Header(props: IHeaderProps) {
    const { children } = props;
    const { t } = useTranslation();

    return (
        <div className="components--modal-base-header">
            <div className="components--modal-base-header-main">{children}</div>
            <div className="components--modal-base-header-right">
                <button
                    type="button"
                    aria-label={t("common.close")}
                    className="components--modal-base-header-close opacity-button"
                    onClick={() => {
                        hideModal();
                    }}
                >
                    <SvgAsset iconName="x-mark"></SvgAsset>
                </button>
            </div>
        </div>
    );
}

Base.Header = Header;
export default Base;

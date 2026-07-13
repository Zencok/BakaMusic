import { useEffect, useRef } from "react";
import { RequestStateCode } from "@/common/constant";
import "./index.scss";
import { useTranslation } from "react-i18next";
import AppConfig from "@shared/app-config/renderer";

interface IProps {
    state: RequestStateCode;
    onLoadMore?: () => void;
}

export default function BottomLoadingState(props: IProps) {
    const { state, onLoadMore } = props;
    const stateRef = useRef<RequestStateCode>(state);
    stateRef.current = state;
    const onLoadMoreRef = useRef(onLoadMore);
    onLoadMoreRef.current = onLoadMore;

    const containerRef = useRef<HTMLDivElement | null>(null);
    const isIntersectingRef = useRef(false);

    const { t } = useTranslation();

    useEffect(() => {
        const node = containerRef.current;
        if (!node) {
            return;
        }

        const intersectionObserver = new IntersectionObserver((entries) => {
            const intersecting = (entries[0]?.intersectionRatio ?? 0) > 0;
            isIntersectingRef.current = intersecting;
            if (
                intersecting
                && AppConfig.getConfig("normal.autoLoadMore")
                && stateRef.current === RequestStateCode.PARTLY_DONE
            ) {
                onLoadMoreRef.current?.();
            }
        });

        intersectionObserver.observe(node);

        return () => {
            intersectionObserver.disconnect();
        };
    }, []);

    // Re-trigger when list returns to PARTLY_DONE while footer is still on screen
    // (IntersectionObserver only fires on intersection *changes*)
    useEffect(() => {
        if (
            state === RequestStateCode.PARTLY_DONE
            && isIntersectingRef.current
            && AppConfig.getConfig("normal.autoLoadMore")
        ) {
            onLoadMoreRef.current?.();
        }
    }, [state]);

    let component = null;

    if (state === RequestStateCode.FINISHED) {
        component = <span className="bottom-loading-state--reach-end">{t("bottom_loading_state.reached_end")}</span>;
    } else if (state === RequestStateCode.PENDING_REST_PAGE || state === RequestStateCode.PENDING_FIRST_PAGE) {
        component = <div className="bottom-loading-state--loading">
            <div className="bottom-loading-state--liquid" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
            </div>
            <span>{t("bottom_loading_state.loading")}</span>
        </div>;
    } else if (state === RequestStateCode.PARTLY_DONE) {
        component = <span className="bottom-loading-state--loadmore" role="button" onClick={onLoadMore}>
            {t("bottom_loading_state.load_more")}
        </span>;
    } else if (state === RequestStateCode.ERROR) {
        component = <span className="bottom-loading-state--loadmore" role="button" onClick={onLoadMore}>
            {t("bottom_loading_state.load_more")}
        </span>;
    }

    return <div className="bottom-loading-state" ref={containerRef}>
        {component}
    </div>;
}

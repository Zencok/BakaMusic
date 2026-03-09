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

    const containerRef = useRef<HTMLDivElement | null>(null);

    const { t } = useTranslation();

    useEffect(() => {
        const intersectionObserver = new IntersectionObserver((entries) => {
            if(AppConfig.getConfig("normal.autoLoadMore") && stateRef.current === RequestStateCode.PARTLY_DONE && entries[0].intersectionRatio > 0) {
                if (onLoadMore) {
                    onLoadMore();
                }
            }
        });

        if (containerRef.current) {
            intersectionObserver.observe(containerRef.current);
        }

        return () => {
            if (containerRef.current) {
                intersectionObserver.unobserve(containerRef.current);
            }
        };
    }, [onLoadMore]);


    let component = null;

    if (state === RequestStateCode.FINISHED) {
        component = <span className="bottom-loading-state--reach-end">{t("bottom_loading_state.reached_end")}</span>;
    } else if (state === RequestStateCode.PENDING_REST_PAGE) {
        component = <>
            <div className="lds-dual-ring"></div> {t("bottom_loading_state.loading")}
        </>;
    } else if (state === RequestStateCode.PARTLY_DONE) {
        component = <span className="bottom-loading-state--loadmore" role="button" onClick={onLoadMore}>
            {t("bottom_loading_state.load_more")}
        </span>;
    }

    return <div className="bottom-loading-state" ref={containerRef}>
        {component}
    </div>;

  
}

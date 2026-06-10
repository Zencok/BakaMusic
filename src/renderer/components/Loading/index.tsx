import { useTranslation } from "react-i18next";
import "./index.scss";

interface ILoadingProps {
    text?: string
}
export default function Loading(props: ILoadingProps) {
    const { t } = useTranslation();

    return (
        <div className="loading-container">
            <div className="liquid-glass-loader" aria-hidden="true">
                <div className="liquid-glass-loader__orb"></div>
                <div className="liquid-glass-loader__drop"></div>
                <div className="liquid-glass-loader__drop"></div>
                <div className="liquid-glass-loader__drop"></div>
            </div>
            <span>{props.text ?? t("common.loading")}</span>
        </div>
    );
}

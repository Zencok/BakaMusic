import "./index.scss";
import CheckBoxSettingItem from "../../components/CheckBoxSettingItem";
import InputSettingItem from "../../components/InputSettingItem";
import SettingGroup from "../../components/SettingGroup";
import { useEffect, useState } from "react";
import { normalizeFileSize } from "@/common/normalize-util";
import { Trans, useTranslation } from "react-i18next";
import useAppConfig from "@/hooks/useAppConfig";
import { appUtil } from "@shared/utils/renderer";

export default function Network() {
    const proxyEnabled = !!useAppConfig("network.proxy.enabled");
    const [cacheSize, setCacheSize] = useState(NaN);
    const { t } = useTranslation();

    useEffect(() => {
        appUtil.getCacheSize().then((res) => {
            setCacheSize(res);
        });
    }, []);

    return (
        <div className="setting-view--network-container">
            <SettingGroup
                title={t("settings.group.proxy")}
                description={t("settings.group.proxy_desc")}
            >
                <CheckBoxSettingItem
                    label={t("settings.network.enable_network_proxy")}
                    keyPath="network.proxy.enabled"
                ></CheckBoxSettingItem>

                <div className="proxy-container" data-disabled={!proxyEnabled}>
                    <InputSettingItem
                        width="100%"
                        label={t("settings.network.host")}
                        disabled={!proxyEnabled}
                        keyPath="network.proxy.host"
                        trim
                    ></InputSettingItem>
                    <InputSettingItem
                        width="100%"
                        label={t("settings.network.port")}
                        disabled={!proxyEnabled}
                        keyPath="network.proxy.port"
                        trim
                    ></InputSettingItem>
                    <InputSettingItem
                        width="100%"
                        label={t("settings.network.username")}
                        disabled={!proxyEnabled}
                        keyPath="network.proxy.username"
                        trim
                    ></InputSettingItem>
                    <InputSettingItem
                        width="100%"
                        label={t("settings.network.password")}
                        type="password"
                        disabled={!proxyEnabled}
                        keyPath="network.proxy.password"
                        trim
                    ></InputSettingItem>
                </div>
            </SettingGroup>

            <SettingGroup
                title={t("settings.group.cache")}
                description={t("settings.group.cache_desc")}
            >
                <div className="setting-row network-cache-container">
                    <div className="network-cache-label">
                        <Trans
                            i18nKey={"settings.network.local_cache"}
                            values={{
                                cacheSize: isNaN(cacheSize) ? "-" : normalizeFileSize(cacheSize),
                            }}
                        ></Trans>
                    </div>
                    <div
                        role="button"
                        data-type="normalButton"
                        onClick={() => {
                            setCacheSize(0);
                            appUtil.clearCache();
                        }}
                    >
                        {t("settings.network.clear_cache")}
                    </div>
                </div>
            </SettingGroup>
        </div>
    );
}

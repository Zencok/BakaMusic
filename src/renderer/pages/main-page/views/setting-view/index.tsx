import "./index.scss";
import routers from "./routers";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import camelToSnake from "@/common/camel-to-snake";
import SvgAsset, { type SvgAssetIconNames } from "@/renderer/components/SvgAsset";

const sectionIcons: Record<string, SvgAssetIconNames> = {
    normal: "cog-8-tooth",
    playMusic: "headphone",
    download: "array-download-tray",
    lyric: "lyric",
    plugin: "code-bracket-square",
    shortCut: "dashboard-speed",
    network: "arrow-path",
    backup: "folder-open",
    about: "identification",
};

export default function SettingView() {
    const [selected, setSelected] = useState(routers[0].id);
    const { t } = useTranslation();

    const intersectionObserverRef = useRef<IntersectionObserver | null>(null);
    const bodyContainerRef = useRef<HTMLDivElement | null>(null);
    const intersectionRatioRef = useRef<Map<string, number>>(new Map());

    const scrollToSection = (settingId: string) => {
        const target = document.getElementById(`setting-${settingId}`);
        target?.scrollIntoView({
            behavior: "smooth",
            block: "start",
        });
    };

    useEffect(() => {
        intersectionObserverRef.current = new IntersectionObserver(
            (targets) => {
                const ratio = intersectionRatioRef.current;
                targets.forEach((target) => {
                    ratio.set(target.target.id, target.intersectionRatio);
                });
                let maxVal = -1;
                let maxId: string | null = null;
                for (const entry of ratio.entries()) {
                    if (entry[1] > maxVal) {
                        maxId = entry[0];
                        maxVal = entry[1];
                    }
                }
                if (maxId) {
                    setSelected(maxId.slice("setting-".length));
                }
            },
            {
                root: bodyContainerRef.current,
                rootMargin: "-12% 0px -62% 0px",
                threshold: [0, 0.1, 0.35, 0.7, 1],
            },
        );

        for (const setting of routers) {
            const target = document.getElementById(`setting-${setting.id}`);
            if (target) {
                intersectionObserverRef.current?.observe(target);
            }
        }
        return () => {
            document
                .getElementById("page-container")
                ?.classList?.remove("page-container-full-width");

            intersectionObserverRef.current?.disconnect();
            intersectionObserverRef.current = null;
            intersectionRatioRef.current.clear();
        };
    }, []);

    return (
        <div
            id="page-container"
            className="page-container-fw setting-view--container"
        >
            <div className="setting-view--shell">
                <aside className="setting-view--sidebar">
                    <div className="setting-view--sidebar-title">
                        {t("app_header.settings")}
                    </div>
                    <nav className="setting-view--nav">
                        {routers.map((setting) => (
                            <button
                                key={setting.id}
                                className="setting-view--nav-item"
                                data-selected={selected === setting.id}
                                type="button"
                                onClick={() => {
                                    scrollToSection(setting.id);
                                }}
                            >
                                <SvgAsset
                                    iconName={sectionIcons[setting.id] ?? "cog-8-tooth"}
                                    size={18}
                                ></SvgAsset>
                                <span>
                                    {t(`settings.section_name.${camelToSnake(setting.id)}`)}
                                </span>
                            </button>
                        ))}
                    </nav>
                </aside>
                <div className="setting-view--body" ref={bodyContainerRef}>
                    <div className="setting-view--content">
                        {routers.map((setting) => {
                            const Component = setting.component;

                            return (
                                <section
                                    key={setting.id}
                                    className="setting-view--body-item-container"
                                    id={`setting-${setting.id}`}
                                >
                                    <div className="setting-view--body-title">
                                        <SvgAsset
                                            iconName={sectionIcons[setting.id] ?? "cog-8-tooth"}
                                            size={20}
                                        ></SvgAsset>
                                        <span>
                                            {t(`settings.section_name.${camelToSnake(setting.id)}`)}
                                        </span>
                                    </div>
                                    <div className="setting-view--body-content">
                                        <Component></Component>
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

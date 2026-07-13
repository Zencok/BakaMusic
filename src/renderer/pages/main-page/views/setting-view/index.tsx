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

const LAST_SECTION_ID = routers[routers.length - 1]?.id ?? "about";
/** Distance from the body top used to decide which section is active */
const ACTIVE_SECTION_OFFSET_PX = 72;
const SCROLL_BOTTOM_THRESHOLD_PX = 12;

function resolveActiveSectionId(scrollRoot: HTMLElement): string {
    const { scrollTop, clientHeight, scrollHeight } = scrollRoot;
    const distanceToBottom = scrollHeight - (scrollTop + clientHeight);

    // Last section is often shorter than the viewport; force-select it near the bottom
    if (distanceToBottom <= SCROLL_BOTTOM_THRESHOLD_PX) {
        return LAST_SECTION_ID;
    }

    const rootTop = scrollRoot.getBoundingClientRect().top;
    let activeId = routers[0]?.id ?? "normal";

    for (const setting of routers) {
        const section = document.getElementById(`setting-${setting.id}`);
        if (!section) {
            continue;
        }

        const sectionTop = section.getBoundingClientRect().top - rootTop;
        // Last section whose top has crossed the active offset wins
        if (sectionTop <= ACTIVE_SECTION_OFFSET_PX) {
            activeId = setting.id;
        }
    }

    return activeId;
}

export default function SettingView() {
    const [selected, setSelected] = useState(routers[0].id);
    const { t } = useTranslation();

    const bodyContainerRef = useRef<HTMLDivElement | null>(null);
    /** While programmatic scroll is running, keep the clicked tab selected */
    const programmaticScrollTargetRef = useRef<string | null>(null);
    const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const scrollToSection = (settingId: string) => {
        const target = document.getElementById(`setting-${settingId}`);
        if (!target) {
            return;
        }

        programmaticScrollTargetRef.current = settingId;
        setSelected(settingId);

        if (programmaticScrollTimerRef.current) {
            clearTimeout(programmaticScrollTimerRef.current);
        }

        target.scrollIntoView({
            behavior: "smooth",
            block: "start",
        });

        // Release lock after smooth scroll settles (or user scrolls manually)
        programmaticScrollTimerRef.current = setTimeout(() => {
            programmaticScrollTargetRef.current = null;
            programmaticScrollTimerRef.current = null;

            const root = bodyContainerRef.current;
            if (root) {
                setSelected(resolveActiveSectionId(root));
            }
        }, 450);
    };

    useEffect(() => {
        const root = bodyContainerRef.current;
        if (!root) {
            return;
        }

        let frameId = 0;
        const syncSelectedFromScroll = () => {
            frameId = 0;
            if (programmaticScrollTargetRef.current) {
                return;
            }
            setSelected(resolveActiveSectionId(root));
        };

        const onScroll = () => {
            if (frameId) {
                return;
            }
            frameId = requestAnimationFrame(syncSelectedFromScroll);
        };

        root.addEventListener("scroll", onScroll, { passive: true });
        // Initial sync
        setSelected(resolveActiveSectionId(root));

        return () => {
            root.removeEventListener("scroll", onScroll);
            if (frameId) {
                cancelAnimationFrame(frameId);
            }
            if (programmaticScrollTimerRef.current) {
                clearTimeout(programmaticScrollTimerRef.current);
                programmaticScrollTimerRef.current = null;
            }
            programmaticScrollTargetRef.current = null;

            document
                .getElementById("page-container")
                ?.classList?.remove("page-container-full-width");
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

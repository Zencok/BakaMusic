import "./index.scss";
import routers, { settingSectionGroups } from "./routers";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import camelToSnake from "@/common/camel-to-snake";
import SvgAsset from "@/renderer/components/SvgAsset";

const LAST_SECTION_ID = routers[routers.length - 1]?.id ?? "about";
/** Distance from the body top used to decide which section is active */
const ACTIVE_SECTION_OFFSET_PX = 96;
/** How long scroll must be idle after a jump before scroll-spy resumes */
const SCROLL_IDLE_MS = 80;
/** Near-bottom only wins when the last section itself is in view */
const SCROLL_BOTTOM_THRESHOLD_PX = 24;

function resolveActiveSectionId(scrollRoot: HTMLElement): string {
    const { scrollTop, clientHeight, scrollHeight } = scrollRoot;
    const distanceToBottom = scrollHeight - (scrollTop + clientHeight);
    const rootTop = scrollRoot.getBoundingClientRect().top;

    const lastSection = document.getElementById(`setting-${LAST_SECTION_ID}`);
    if (lastSection && distanceToBottom <= SCROLL_BOTTOM_THRESHOLD_PX) {
        const lastTop = lastSection.getBoundingClientRect().top - rootTop;
        // Only pin "about" when its header has actually reached the active band.
        if (lastTop <= ACTIVE_SECTION_OFFSET_PX + 40) {
            return LAST_SECTION_ID;
        }
    }

    let activeId = routers[0]?.id ?? "appearance";
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
    /** Clicked section id while programmatic smooth scroll is in progress */
    const programmaticScrollTargetRef = useRef<string | null>(null);
    const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scrollFrameRef = useRef(0);

    const sectionById = useMemo(
        () => new Map(routers.map((section) => [section.id, section])),
        [],
    );

    const clearScrollIdleTimer = () => {
        if (scrollIdleTimerRef.current) {
            clearTimeout(scrollIdleTimerRef.current);
            scrollIdleTimerRef.current = null;
        }
    };

    const releaseProgrammaticLock = (preferId?: string | null) => {
        const lockedId = preferId ?? programmaticScrollTargetRef.current;
        programmaticScrollTargetRef.current = null;
        clearScrollIdleTimer();
        if (lockedId) {
            setSelected(lockedId);
        }
    };

    const scrollToSection = (settingId: string) => {
        const target = document.getElementById(`setting-${settingId}`);
        const root = bodyContainerRef.current;
        if (!target || !root) {
            return;
        }

        // Instant jump + short lock so scroll-spy does not flicker through neighbors.
        programmaticScrollTargetRef.current = settingId;
        setSelected(settingId);
        clearScrollIdleTimer();

        const rootStyle = getComputedStyle(root);
        const targetStyle = getComputedStyle(target);
        const scrollPaddingTop = Number.parseFloat(rootStyle.scrollPaddingTop) || 0;
        const scrollMarginTop = Number.parseFloat(targetStyle.scrollMarginTop) || 0;
        const rootTop = root.getBoundingClientRect().top;
        const targetTop = target.getBoundingClientRect().top;

        // Scroll only the settings body. Element.scrollIntoView() also scrolls
        // fixed overflow ancestors when the retained detail page is translated.
        root.scrollTo({
            behavior: "auto",
            top: Math.max(
                0,
                root.scrollTop
                    + targetTop
                    - rootTop
                    - scrollPaddingTop
                    - scrollMarginTop,
            ),
        });

        // Release after the jump settles (scroll events from the jump go idle quickly).
        scrollIdleTimerRef.current = setTimeout(() => {
            if (programmaticScrollTargetRef.current === settingId) {
                releaseProgrammaticLock(settingId);
            }
        }, SCROLL_IDLE_MS);
    };

    useEffect(() => {
        const root = bodyContainerRef.current;
        if (!root) {
            return;
        }

        const syncSelectedFromScroll = () => {
            scrollFrameRef.current = 0;

            // During a nav jump, keep the sidebar pinned until scroll is idle.
            if (programmaticScrollTargetRef.current) {
                clearScrollIdleTimer();
                scrollIdleTimerRef.current = setTimeout(() => {
                    releaseProgrammaticLock();
                }, SCROLL_IDLE_MS);
                return;
            }

            setSelected(resolveActiveSectionId(root));
        };

        const onScroll = () => {
            if (scrollFrameRef.current) {
                return;
            }
            scrollFrameRef.current = requestAnimationFrame(syncSelectedFromScroll);
        };

        root.addEventListener("scroll", onScroll, { passive: true });
        setSelected(resolveActiveSectionId(root));

        return () => {
            root.removeEventListener("scroll", onScroll);
            if (scrollFrameRef.current) {
                cancelAnimationFrame(scrollFrameRef.current);
            }
            clearScrollIdleTimer();
            programmaticScrollTargetRef.current = null;

            document
                .getElementById("page-container")
                ?.classList?.remove("page-container-full-width");
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div
            id="page-container"
            className="page-container-fw setting-view--container"
        >
            <div className="setting-view--shell">
                <aside className="setting-view--sidebar">
                    <div className="setting-view--sidebar-header">
                        <div className="setting-view--sidebar-title">
                            {t("app_header.settings")}
                        </div>
                        <div className="setting-view--sidebar-subtitle">
                            {t("settings.page_subtitle")}
                        </div>
                    </div>
                    <nav className="setting-view--nav" aria-label={t("app_header.settings")}>
                        {settingSectionGroups.map((group) => (
                            <div className="setting-view--nav-group" key={group.id}>
                                <div className="setting-view--nav-group-label">
                                    {t(`settings.nav_group.${group.id}`)}
                                </div>
                                {group.sectionIds.map((sectionId) => {
                                    const setting = sectionById.get(sectionId);
                                    if (!setting) {
                                        return null;
                                    }
                                    return (
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
                                                iconName={setting.icon}
                                                size={18}
                                            ></SvgAsset>
                                            <span>
                                                {t(`settings.section_name.${camelToSnake(setting.id)}`)}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        ))}
                    </nav>
                </aside>
                <div className="setting-view--body" ref={bodyContainerRef}>
                    <div className="setting-view--content">
                        {routers.map((setting) => {
                            const Component = setting.component;
                            const sectionKey = camelToSnake(setting.id);
                            const descriptionKey = `settings.section_desc.${sectionKey}`;
                            const description = t(descriptionKey);
                            const hasDescription = description !== descriptionKey;

                            return (
                                <section
                                    key={setting.id}
                                    className="setting-view--body-item-container"
                                    id={`setting-${setting.id}`}
                                >
                                    <div className="setting-view--body-title">
                                        <div className="setting-view--body-title-icon">
                                            <SvgAsset
                                                iconName={setting.icon}
                                                size={20}
                                            ></SvgAsset>
                                        </div>
                                        <div className="setting-view--body-title-copy">
                                            <span className="setting-view--body-title-text">
                                                {t(`settings.section_name.${sectionKey}`)}
                                            </span>
                                            {hasDescription ? (
                                                <span className="setting-view--body-title-desc">
                                                    {description}
                                                </span>
                                            ) : null}
                                        </div>
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

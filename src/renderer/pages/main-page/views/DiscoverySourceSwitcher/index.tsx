import { Tab } from "@headlessui/react";
import {
    CSSProperties,
    useCallback,
    useEffect,
    useLayoutEffect,
    useState,
} from "react";

import "./index.scss";
import useHorizontalWheel from "@/hooks/useHorizontalWheel";

interface IDiscoverySourceSwitcherProps {
    label: string;
    plugins: IPlugin.IPluginDelegate[];
}

interface IIndicatorRect {
    left: number;
    width: number;
}

function isReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 依据滚动位置标记两端渐隐，避免溢出时文字被硬裁 */
function updateRailFade(rail: HTMLElement) {
    rail.dataset.fadeStart = String(rail.scrollLeft > 1);
    rail.dataset.fadeEnd = String(
        rail.scrollWidth - rail.clientWidth - rail.scrollLeft > 1,
    );
}

function getRailTabs(rail: HTMLElement) {
    return Array.from(rail.querySelectorAll<HTMLElement>("[role='tab']"));
}

export default function DiscoverySourceSwitcher(props: IDiscoverySourceSwitcherProps) {
    const { label, plugins } = props;
    const handlePlatformWheel = useHorizontalWheel<HTMLDivElement>();
    // 用 state 承接 ref：子组件的 layout effect 早于父级 host ref 挂载，
    // 只有回调 ref 触发的重渲染能保证首帧拿到真实节点
    const [rail, setRail] = useState<HTMLElement | null>(null);

    return (
        <div className="discovery-source-switcher">
            <Tab.List
                ref={setRail}
                className="discovery-source-rail"
                aria-label={label}
                onWheel={handlePlatformWheel}
            >
                {({ selectedIndex }) => (
                    <DiscoverySourceRail
                        rail={rail}
                        plugins={plugins}
                        selectedIndex={selectedIndex}
                    ></DiscoverySourceRail>
                )}
            </Tab.List>
        </div>
    );
}

interface IDiscoverySourceRailProps {
    rail: HTMLElement | null;
    plugins: IPlugin.IPluginDelegate[];
    selectedIndex: number;
}

function DiscoverySourceRail(props: IDiscoverySourceRailProps) {
    const { rail, plugins, selectedIndex } = props;
    const [indicator, setIndicator] = useState<IIndicatorRect | null>(null);
    const pluginsKey = plugins.map((plugin) => plugin.hash).join("|");

    const syncRail = useCallback(() => {
        if (!rail) {
            return;
        }

        updateRailFade(rail);

        const activeTab = getRailTabs(rail)[selectedIndex];

        if (!activeTab) {
            setIndicator(null);
            return;
        }

        const left = activeTab.offsetLeft;
        const width = activeTab.offsetWidth;

        setIndicator((prev) =>
            prev && prev.left === left && prev.width === width
                ? prev
                : { left, width },
        );
    }, [rail, selectedIndex]);

    // 首帧同步测量，指示条直接落位而不是从 0 位滑入
    useLayoutEffect(() => {
        syncRail();
    }, [syncRail, pluginsKey]);

    // 容器宽度或字体度量变化后重新对齐
    useEffect(() => {
        if (!rail || typeof ResizeObserver === "undefined") {
            return;
        }

        const observer = new ResizeObserver(() => {
            syncRail();
        });

        observer.observe(rail);
        getRailTabs(rail).forEach((tab) => {
            observer.observe(tab);
        });

        return () => {
            observer.disconnect();
        };
    }, [rail, syncRail, pluginsKey]);

    useEffect(() => {
        if (!rail) {
            return;
        }

        const onScroll = () => {
            updateRailFade(rail);
        };

        rail.addEventListener("scroll", onScroll, { passive: true });

        return () => {
            rail.removeEventListener("scroll", onScroll);
        };
    }, [rail]);

    // 音源较多时把选中项带回可视区
    useEffect(() => {
        const activeTab = rail ? getRailTabs(rail)[selectedIndex] : undefined;

        if (!rail || !activeTab) {
            return;
        }

        const visibleStart = rail.scrollLeft;
        const visibleEnd = visibleStart + rail.clientWidth;

        if (
            activeTab.offsetLeft >= visibleStart &&
            activeTab.offsetLeft + activeTab.offsetWidth <= visibleEnd
        ) {
            return;
        }

        rail.scrollTo({
            left:
                activeTab.offsetLeft -
                (rail.clientWidth - activeTab.offsetWidth) / 2,
            behavior: isReducedMotion() ? "auto" : "smooth",
        });
    }, [rail, selectedIndex]);

    return (
        <>
            {plugins.map((plugin) => (
                <Tab
                    key={plugin.hash}
                    className="discovery-source-tab"
                    title={plugin.platform}
                >
                    <span
                        className="discovery-source-tab-name"
                        data-text={plugin.platform}
                    >
                        {plugin.platform}
                    </span>
                </Tab>
            ))}
            {indicator ? (
                <span
                    className="discovery-source-indicator"
                    aria-hidden="true"
                    style={
                        {
                            "--source-indicator-x": `${indicator.left}px`,
                            "--source-indicator-w": `${indicator.width}px`,
                        } as CSSProperties
                    }
                ></span>
            ) : null}
        </>
    );
}

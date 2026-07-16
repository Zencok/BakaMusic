import ListItem from "./widgets/ListItem";
import "./index.scss";
import MySheets from "./widgets/MySheets";
import { useMatch, useNavigate } from "react-router";
import StarredSheets from "./widgets/StarredSheets";
import { useTranslation } from "react-i18next";
import { Disclosure } from "@headlessui/react";
import SvgAsset from "@/renderer/components/SvgAsset";

interface INavigationItem {
    iconName: "fire" | "trophy" | "folder-open" | "array-download-tray" | "clock";
    title: string;
    route: string;
}

interface INavigationGroupProps {
    action?: {
        iconName: "code-bracket-square";
        selected: boolean;
        title: string;
        onClick: () => void;
    };
    items: readonly INavigationItem[];
    title: string;
    currentRoute?: string;
    onNavigate: (route: string) => void;
}

function NavigationGroup(props: INavigationGroupProps) {
    const { action, items, title, currentRoute, onNavigate } = props;
    const navigationList = (
        <nav className="side-bar-navigation-list">
            {items.map((item) => (
                <ListItem
                    key={item.route}
                    iconName={item.iconName}
                    title={item.title}
                    selected={currentRoute === item.route}
                    onClick={() => onNavigate(item.route)}
                ></ListItem>
            ))}
        </nav>
    );

    return (
        <section className="side-bar-navigation-group">
            <Disclosure defaultOpen>
                <Disclosure.Button
                    className="side-bar-section-title side-bar-navigation-disclosure-title"
                    as="div"
                    role="button"
                >
                    <div className="side-bar-section-title-main">
                        <div className="side-bar-section-chevron">
                            <SvgAsset iconName="chevron-right"></SvgAsset>
                        </div>
                        <div className="side-bar-section-text">{title}</div>
                    </div>
                    {action ? (
                        <button
                            aria-label={action.title}
                            className="side-bar-navigation-action"
                            data-selected={action.selected}
                            title={action.title}
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                action.onClick();
                            }}
                        >
                            <SvgAsset iconName={action.iconName}></SvgAsset>
                        </button>
                    ) : null}
                </Disclosure.Button>
                <Disclosure.Panel>{navigationList}</Disclosure.Panel>
            </Disclosure>
        </section>
    );
}

export default function SideBar() {
    const navigate = useNavigate();
    const routePathMatch = useMatch("/main/:routePath");
    const { t } = useTranslation();

    const navigationGroups = [
        {
            title: t("side_bar.discover"),
            items: [
                {
                    iconName: "fire",
                    title: t("side_bar.recommend_sheets"),
                    route: "recommend-sheets",
                },
                {
                    iconName: "trophy",
                    title: t("side_bar.toplist"),
                    route: "toplist",
                },
            ],
        },
        {
            title: t("side_bar.library"),
            items: [
                {
                    iconName: "folder-open",
                    title: t("side_bar.local_music"),
                    route: "local-music",
                },
                {
                    iconName: "array-download-tray",
                    title: t("side_bar.download_management"),
                    route: "download",
                },
                {
                    iconName: "clock",
                    title: t("side_bar.statistics"),
                    route: "statistics",
                },
            ],
        },
    ] satisfies Array<{ title: string; items: readonly INavigationItem[] }>;
    const pluginItem = {
        iconName: "code-bracket-square",
        title: t("side_bar.plugin_management"),
        route: "plugin-manager-view",
    } as const;

    return (
        <aside className="side-bar-container">
            <div className="side-bar-scroll-region">
                <div className="side-bar-navigation">
                    {navigationGroups.map((group, index) => (
                        <NavigationGroup
                            action={index === 0 ? {
                                iconName: pluginItem.iconName,
                                selected: routePathMatch?.params?.routePath === pluginItem.route,
                                title: pluginItem.title,
                                onClick: () => navigate(`/main/${pluginItem.route}`),
                            } : undefined}
                            currentRoute={routePathMatch?.params?.routePath}
                            items={group.items}
                            key={group.title}
                            title={group.title}
                            onNavigate={(route) => navigate(`/main/${route}`)}
                        ></NavigationGroup>
                    ))}
                </div>
                <div className="side-bar-playlists">
                    <MySheets></MySheets>
                    <StarredSheets></StarredSheets>
                </div>
            </div>
        </aside>
    );
}

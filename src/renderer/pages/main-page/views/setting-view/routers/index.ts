/** Settings navigation registry — ordered by product IA. */
import type { ComponentType } from "react";
import About from "./About";
import Appearance from "./Appearance";
import Backup from "./Backup";
import Download from "./Download";
import Lyric from "./Lyric";
import Network from "./Network";
import Playback from "./Playback";
import Plugin from "./Plugin";
import ShortCut from "./ShortCut";
import type { SvgAssetIconNames } from "@/renderer/components/SvgAsset";

export type SettingSectionGroupId = "experience" | "media" | "system";

export interface ISettingSectionMeta {
    id: string;
    component: ComponentType;
    icon: SvgAssetIconNames;
    /** Sidebar category for grouped navigation */
    group: SettingSectionGroupId;
}

const routers: ISettingSectionMeta[] = [
    // —— 体验 ——
    {
        id: "appearance",
        component: Appearance,
        icon: "sparkles",
        group: "experience",
    },
    {
        id: "shortCut",
        component: ShortCut,
        icon: "dashboard-speed",
        group: "experience",
    },
    // —— 媒体 ——
    {
        id: "playback",
        component: Playback,
        icon: "headphone",
        group: "media",
    },
    {
        id: "lyric",
        component: Lyric,
        icon: "lyric",
        group: "media",
    },
    {
        id: "download",
        component: Download,
        icon: "array-download-tray",
        group: "media",
    },
    // —— 系统 ——
    {
        id: "network",
        component: Network,
        icon: "arrow-path",
        group: "system",
    },
    {
        id: "plugin",
        component: Plugin,
        icon: "code-bracket-square",
        group: "system",
    },
    {
        id: "backup",
        component: Backup,
        icon: "folder-open",
        group: "system",
    },
    {
        id: "about",
        component: About,
        icon: "identification",
        group: "system",
    },
];

export const settingSectionGroups: Array<{
    id: SettingSectionGroupId;
    sectionIds: string[];
}> = [
    {
        id: "experience",
        sectionIds: ["appearance", "shortCut"],
    },
    {
        id: "media",
        sectionIds: ["playback", "lyric", "download"],
    },
    {
        id: "system",
        sectionIds: ["network", "plugin", "backup", "about"],
    },
];

export default routers;

import localMusicListStore from "@/renderer/core/local-music/store";
import { useTranslation } from "react-i18next";

import "./index.scss";
import { showModal } from "@/renderer/components/Modal";
import SvgAsset from "@/renderer/components/SvgAsset";
import { useEffect, useState, useTransition } from "react";
import SwitchCase from "@/renderer/components/SwitchCase";
import ListView from "./views/list";
import ArtistView from "./views/artist";
import AlbumView from "./views/album";
import FolderView from "./views/folder";
import AppConfig from "@shared/app-config/renderer";
import localMusic from "@renderer/core/local-music";
import { createSearchMatcher } from "@/common/search-matcher";

enum DisplayView {
    LIST,
    ARTIST,
    ALBUM,
    FOLDER,
}

const displayViewLabelMap = {
    [DisplayView.LIST]: "local_music_page.list_view",
    [DisplayView.ARTIST]: "local_music_page.artist_view",
    [DisplayView.ALBUM]: "local_music_page.album_view",
    [DisplayView.FOLDER]: "local_music_page.folder_view",
} satisfies Record<DisplayView, string>;

export default function LocalMusicView() {
    const { t } = useTranslation();
    const [displayView, setDisplayView] = useState(DisplayView.LIST);
    const [isScanning, setIsScanning] = useState(false);

    const localMusicList = localMusicListStore.useValue();
    const [inputSearch, setInputSearch] = useState("");
    const [filterMusicList, setFilterMusicList] = useState<
    IMusic.IMusicItem[] | null
    >(null);

    const [, startTransition] = useTransition();

    useEffect(() => {
        void localMusic.setupLocalMusic();

        return () => {
            localMusic.releaseLocalMusic();
        };
    }, []);

    useEffect(() => {
        if (inputSearch.trim() === "") {
            setFilterMusicList(null);
        } else {
            startTransition(() => {
                const caseSensitive = AppConfig.getConfig(
                    "playMusic.caseSensitiveInSearch",
                );
                const matchesSearch = createSearchMatcher(inputSearch, {
                    caseSensitive: caseSensitive === true,
                });
                setFilterMusicList(
                    localMusicList.filter((item) => matchesSearch([
                        item.title,
                        item.artist,
                        item.album,
                        item.platform,
                        item.$$localPath,
                    ])),
                );
            });
        }
    }, [inputSearch, localMusicList]);

    const finalMusicList = filterMusicList ?? localMusicList;

    return (
        <div
            id="page-container"
            className="page-container local-music-view--container"
            data-full-page={displayView !== DisplayView.LIST}
        >
            <header className="discovery-page-header local-music-hero">
                <div className="discovery-page-heading">
                    <span className="discovery-page-eyebrow">
                        {t("local_music_page.eyebrow")}
                    </span>
                    <h1>{t("local_music_page.local_music")}</h1>
                    <p>{t("local_music_page.subtitle")}</p>
                </div>
            </header>
            <div
                className="discovery-workspace-toolbar local-music-toolbar"
                aria-label={t("local_music_page.local_music")}
            >
                <div
                    className="discovery-toolbar-segments local-music-view-actions"
                    role="group"
                    aria-label={t(displayViewLabelMap[displayView])}
                >
                    <button
                        className="discovery-toolbar-segment list-view-action"
                        data-active={displayView === DisplayView.LIST}
                        aria-pressed={displayView === DisplayView.LIST}
                        title={t("local_music_page.list_view")}
                        type="button"
                        onClick={() => {
                            setDisplayView(DisplayView.LIST);
                        }}
                    >
                        <SvgAsset iconName="musical-note"></SvgAsset>
                        <span>{t("local_music_page.list_view")}</span>
                    </button>
                    <button
                        className="discovery-toolbar-segment list-view-action"
                        data-active={displayView === DisplayView.ARTIST}
                        aria-pressed={displayView === DisplayView.ARTIST}
                        title={t("local_music_page.artist_view")}
                        type="button"
                        onClick={() => {
                            setDisplayView(DisplayView.ARTIST);
                        }}
                    >
                        <SvgAsset iconName="user"></SvgAsset>
                        <span>{t("local_music_page.artist_view")}</span>
                    </button>
                    <button
                        className="discovery-toolbar-segment list-view-action"
                        data-active={displayView === DisplayView.ALBUM}
                        aria-pressed={displayView === DisplayView.ALBUM}
                        title={t("local_music_page.album_view")}
                        type="button"
                        onClick={() => {
                            setDisplayView(DisplayView.ALBUM);
                        }}
                    >
                        <SvgAsset iconName="cd"></SvgAsset>
                        <span>{t("local_music_page.album_view")}</span>
                    </button>
                    <button
                        className="discovery-toolbar-segment list-view-action"
                        data-active={displayView === DisplayView.FOLDER}
                        aria-pressed={displayView === DisplayView.FOLDER}
                        title={t("local_music_page.folder_view")}
                        type="button"
                        onClick={() => {
                            setDisplayView(DisplayView.FOLDER);
                        }}
                    >
                        <SvgAsset iconName="folder-open"></SvgAsset>
                        <span>{t("local_music_page.folder_view")}</span>
                    </button>
                </div>
                <label className="discovery-toolbar-search local-music-search-field">
                    <SvgAsset iconName="magnifying-glass"></SvgAsset>
                    <input
                        className="search-local-music"
                        spellCheck={false}
                        value={inputSearch}
                        aria-label={t("local_music_page.search_local_music")}
                        onChange={(evt) => {
                            setInputSearch(evt.target.value);
                        }}
                        placeholder={t("local_music_page.search_local_music")}
                    ></input>
                    {inputSearch ? (
                        <button
                            type="button"
                            className="discovery-search-clear"
                            title={t("common.clear")}
                            aria-label={t("common.clear")}
                            onClick={() => setInputSearch("")}
                        >
                            <SvgAsset iconName="x-mark" size={13}></SvgAsset>
                        </button>
                    ) : null}
                </label>
                <div className="discovery-toolbar-actions local-music-scan-actions">
                    <button
                        className="discovery-toolbar-button manual-scan-button"
                        data-scanning={isScanning}
                        type="button"
                        title={t("local_music_page.auto_scan")}
                        onClick={async () => {
                            if (isScanning) {
                                return;
                            }

                            setIsScanning(true);
                            try {
                                await localMusic.scanLocalMusicChanges();
                            } finally {
                                setIsScanning(false);
                            }
                        }}
                    >
                        <SvgAsset iconName="arrow-path"></SvgAsset>
                        <span>{isScanning ? t("common.loading") : t("local_music_page.auto_scan")}</span>
                    </button>
                    <button
                        className="discovery-toolbar-button scan-config-button"
                        type="button"
                        title={t("local_music_page.scan_config")}
                        onClick={() => {
                            showModal("WatchLocalDir");
                        }}
                    >
                        <SvgAsset iconName="cog-8-tooth"></SvgAsset>
                        <span>{t("local_music_page.scan_config")}</span>
                    </button>
                </div>
            </div>
            <SwitchCase.Switch switch={displayView}>
                <SwitchCase.Case case={DisplayView.LIST}>
                    <ListView localMusicList={finalMusicList}></ListView>
                </SwitchCase.Case>
                <SwitchCase.Case case={DisplayView.ARTIST}>
                    <ArtistView localMusicList={finalMusicList}></ArtistView>
                </SwitchCase.Case>
                <SwitchCase.Case case={DisplayView.ALBUM}>
                    <AlbumView localMusicList={finalMusicList}></AlbumView>
                </SwitchCase.Case>
                <SwitchCase.Case case={DisplayView.FOLDER}>
                    <FolderView localMusicList={finalMusicList}></FolderView>
                </SwitchCase.Case>
            </SwitchCase.Switch>
        </div>
    );
}

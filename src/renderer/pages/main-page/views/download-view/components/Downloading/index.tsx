import albumImg from "@/assets/imgs/album-cover.jpg";
import { secondsToDuration } from "@/common/time-util";
import useVirtualList from "@/hooks/useVirtualList";
import Empty from "@/renderer/components/Empty";
import Tag from "@/renderer/components/Tag";
import Downloader from "@/renderer/core/downloader";
import { setFallbackAlbum } from "@/renderer/utils/img-on-error";
import { i18n } from "@/shared/i18n/renderer";
import "./index.scss";
import DownloadStatus from "./DownloadStatus";

const estimizeItemHeight = 106;
const compactTagStyle = {
    fontSize: "0.72rem",
    lineHeight: 1.2,
    padding: "2px 8px",
    borderRadius: 999,
    maxWidth: "none",
};

export default function Downloading() {
    const downloadingQueue = Downloader.useDownloadingMusicList();

    const virtualController = useVirtualList({
        data: downloadingQueue,
        scrollElementQuery: "#page-container",
        estimateItemHeight: estimizeItemHeight,
    });

    return (
        <div className="downloading-container">
            <div className="downloading-toolbar">
                <div className="downloading-toolbar-summary">
                    <span className="downloading-toolbar-title">
                        {i18n.t("common.downloading")}
                    </span>
                    <span className="downloading-toolbar-count">
                        {downloadingQueue.length}
                    </span>
                </div>
            </div>
            {downloadingQueue.length ? (
                <div
                    className="downloading-virtual-spacer"
                    style={{
                        height: virtualController.totalHeight,
                    }}
                >
                    <div
                        className="downloading-virtual-content"
                        style={{
                            transform: `translateY(${virtualController.startTop}px)`,
                        }}
                    >
                        {virtualController.virtualItems.map((virtualItem) => {
                            const musicItem = virtualItem.dataItem;
                            return (
                                <div
                                    className="downloading-item-wrapper"
                                    key={`${musicItem.platform}-${musicItem.id}-${virtualItem.rowIndex}`}
                                >
                                    <div className="downloading-item-card">
                                        <div className="downloading-item-leading">
                                            <span className="downloading-item-index">
                                                {String(virtualItem.rowIndex + 1).padStart(2, "0")}
                                            </span>
                                            <div className="downloading-item-cover">
                                                <img
                                                    src={musicItem.artwork ?? albumImg}
                                                    alt={musicItem.title}
                                                    onError={setFallbackAlbum}
                                                ></img>
                                            </div>
                                        </div>
                                        <div className="downloading-item-main">
                                            <div className="downloading-item-title" title={musicItem.title}>
                                                {musicItem.title}
                                            </div>
                                            <div
                                                className="downloading-item-subtitle"
                                                title={`${musicItem.artist || ""}${musicItem.album ? ` · ${musicItem.album}` : ""}`}
                                            >
                                                {musicItem.artist}
                                                {musicItem.album ? ` · ${musicItem.album}` : ""}
                                            </div>
                                            <div className="downloading-item-meta">
                                                <Tag fill style={compactTagStyle}>
                                                    {musicItem.platform}
                                                </Tag>
                                                <Tag style={compactTagStyle}>
                                                    {musicItem.duration
                                                        ? secondsToDuration(musicItem.duration)
                                                        : "--:--"}
                                                </Tag>
                                            </div>
                                        </div>
                                        <div className="downloading-item-status">
                                            <DownloadStatus musicItem={musicItem}></DownloadStatus>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <Empty></Empty>
            )}
        </div>
    );
}


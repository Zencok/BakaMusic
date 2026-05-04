import "./index.scss";
import { useEffect, useMemo, useRef, useState } from "react";
import groupBy from "@/renderer/utils/groupBy";
import MusicList from "@/renderer/components/MusicList";

interface IProps {
    localMusicList: IMusic.IMusicItem[];
}

export default function AlbumView(props: IProps) {
    const { localMusicList } = props;

    const [keys, allMusic] = useMemo(() => {
        const grouped = groupBy(
            localMusicList ?? [],
            (it) => `${it.album} - ${it.artist}`,
        );
        return [Object.keys(grouped).sort((a, b) => a.localeCompare(b)), grouped];
    }, [localMusicList]);

    const [selectedKey, setSelectedKey] = useState<string>();
    const rightPartRef = useRef<HTMLDivElement>(null);

    const actualSelectedKey = selectedKey ?? keys?.[0];

    useEffect(() => {
        if (!actualSelectedKey || keys.includes(actualSelectedKey)) {
            return;
        }
        setSelectedKey(keys[0]);
    }, [actualSelectedKey, keys]);

    return (
        <div className="local-music--album-view-container">
            <div className="left-part">
                {keys.map((it) => (
                    <div
                        className="album-item list-behavior"
                        key={it}
                        data-selected={actualSelectedKey === it}
                        onClick={() => {
                            setSelectedKey(it);
                        }}
                    >
                        <span>{it.split(" - ")[0]}</span>
                        <span>{it.split(" - ")[1]}</span>
                    </div>
                ))}
            </div>
            <div className="right-part" ref={rightPartRef}>
                <MusicList
                    sortStorageKey="local-music"
                    musicList={allMusic[actualSelectedKey as any] ?? []}
                    hideRows={["album"]}
                    virtualProps={{
                        getScrollElement() {
                            return rightPartRef.current;
                        },
                        fallbackRenderCount: 40,
                    }}
                ></MusicList>
            </div>
        </div>
    );
}

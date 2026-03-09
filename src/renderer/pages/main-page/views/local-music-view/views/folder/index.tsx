import "./index.scss";
import { useEffect, useMemo, useRef, useState } from "react";
import groupBy from "@/renderer/utils/groupBy";
import MusicList from "@/renderer/components/MusicList";
import { Trans } from "react-i18next";

interface IProps {
    localMusicList: IMusic.IMusicItem[];
}

export default function FolderView(props: IProps) {
    const { localMusicList } = props;

    const [keys, allMusic] = useMemo(() => {
        const grouped = groupBy(localMusicList ?? [], (it) =>
            window.path.dirname(it.$$localPath),
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
        <div className="local-music--folder-view-container">
            <div className="left-part">
                {keys.map((it) => (
                    <div
                        className="folder-item list-behavior"
                        key={it}
                        data-selected={actualSelectedKey === it}
                        onClick={() => {
                            setSelectedKey(it);
                        }}
                    >
                        <span>{it}</span>
                        <span>
                            <Trans
                                i18nKey={"local_music_page.total_music_num"}
                                values={{
                                    number: allMusic?.[it]?.length ?? 0,
                                }}
                            ></Trans>
                        </span>
                    </div>
                ))}
            </div>
            <div className="right-part" ref={rightPartRef}>
                <MusicList
                    musicList={allMusic[actualSelectedKey] ?? []}
                    hideRows={["artist"]}
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

import MusicList from "@/renderer/components/MusicList";
import type { CSSProperties } from "react";

interface IProps {
    localMusicList: IMusic.IMusicItem[];
}

// 提升为模块常量：本地音乐页每次输入都会重渲染，内联字面量会让
// MusicList 的 memo 永远失效（整表连同每行音质计算重算一遍）。
const containerStyle: CSSProperties = {
    marginTop: "12px",
};

const virtualProps = {
    getScrollElement() {
        return document.querySelector<HTMLElement>("#page-container");
    },
    fallbackRenderCount: 40,
};

export default function ListView(props: IProps) {
    const { localMusicList } = props;

    return (
        <MusicList
            containerStyle={containerStyle}
            sortStorageKey="local-music"
            musicList={localMusicList}
            virtualProps={virtualProps}
        ></MusicList>
    );
}

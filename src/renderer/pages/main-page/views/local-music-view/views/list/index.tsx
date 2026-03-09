import MusicList from "@/renderer/components/MusicList";

interface IProps {
    localMusicList: IMusic.IMusicItem[];
}

export default function ListView(props: IProps) {
    const { localMusicList } = props;

    return (
        <MusicList
            headerOnlySurface
            containerStyle={{
                marginTop: "12px",
            }}
            musicList={localMusicList}
            virtualProps={{
                getScrollElement() {
                    return document.querySelector("#page-container");
                },
                fallbackRenderCount: 40,
            }}
        ></MusicList>
    );
}

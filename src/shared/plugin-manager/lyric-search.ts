export function lyricSearchKeyword(item: IMusic.IMusicItem): string {
    return [item.artist.trim(), item.title.trim()].filter(Boolean).join(" - ");
}

export function lyricSearchContext(
    item: IMusic.IMusicItem,
    platform: string,
): IPlugin.ILyricSearchContext {
    const duration = Number(item.duration);
    return {
        title: item.title,
        artist: item.artist,
        durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : undefined,
        musicItem: item.platform === platform ? {
            id: item.id,
            hash: item.hash,
            kg_song_id: item.kg_song_id,
            album_audio_id: item.album_audio_id,
        } : undefined,
    };
}

import { getDefaultAlbumCover } from "@/renderer/utils/default-album-cover";
import { SyntheticEvent } from "react";

export function setFallbackAlbum(evt: SyntheticEvent<HTMLImageElement>) {
    (evt.target as HTMLImageElement).src = getDefaultAlbumCover();
}

/**
 * Helpers for music identity display / copy / share in context menus.
 * Field names vary by platform plugin (QQ / Netease / Kugou / Kuwo / Migu…).
 */

function nonEmpty(value: unknown): string | null {
    if (value == null) {
        return null;
    }
    const text = String(value).trim();
    return text.length ? text : null;
}

function pickFirst(...candidates: unknown[]): string | null {
    for (const candidate of candidates) {
        const text = nonEmpty(candidate);
        if (text) {
            return text;
        }
    }
    return null;
}

function formatIdPairs(parts: Array<[string, string | null]>): string {
    return parts
        .filter((entry): entry is [string, string] => !!entry[1])
        .map(([label, value]) => `${label}: ${value}`)
        .join(", ");
}

export interface IMusicSongIds {
    id: string | null;
    songmid: string | null;
    mid: string | null;
    hash: string | null;
    copyrightId: string | null;
}

export function getMusicSongIds(musicItem: IMusic.IMusicItemPartial): IMusicSongIds {
    const item = musicItem as Record<string, unknown>;
    return {
        id: pickFirst(item.id, item.songid, item.songId),
        songmid: pickFirst(item.songmid, item.songMid),
        mid: pickFirst(item.mid, item.media_mid, item.mediaMid),
        hash: pickFirst(item.hash, item.FileHash, item.fileHash),
        copyrightId: pickFirst(
            item.copyrightId,
            item.copyright_id,
            item.contentId,
            item.content_id,
        ),
    };
}

export function formatMusicSongIdTitle(musicItem: IMusic.IMusicItemPartial): string {
    const platform = nonEmpty(musicItem.platform) ?? "unknown";
    const ids = getMusicSongIds(musicItem);
    const mid = ids.songmid || ids.mid;
    const pairText = formatIdPairs([
        ["id", ids.id],
        ["mid", mid && mid !== ids.id ? mid : null],
        ["hash", ids.hash && ids.hash !== ids.id ? ids.hash : null],
        ["copyrightId", ids.copyrightId && ids.copyrightId !== ids.id ? ids.copyrightId : null],
    ]);
    if (pairText) {
        return `ID: ${platform} (${pairText})`;
    }
    return `ID: ${platform}`;
}

export function buildMusicSongCopyPayload(musicItem: IMusic.IMusicItemPartial): string {
    const ids = getMusicSongIds(musicItem);
    const payload: Record<string, string> = {
        platform: String(musicItem.platform ?? ""),
    };
    const name = nonEmpty(musicItem.title);
    if (name) {
        payload.name = name;
    }
    if (ids.id) {
        payload.id = ids.id;
    }
    const mid = ids.songmid || ids.mid;
    if (mid) {
        payload.mid = mid;
    }
    if (ids.hash) {
        payload.hash = ids.hash;
    }
    if (ids.copyrightId) {
        payload.copyrightId = ids.copyrightId;
    }
    return JSON.stringify(payload);
}

export interface IMusicArtistEntry {
    name: string | null;
    artistId: string | null;
    artistMid: string | null;
    avatar: string | null;
}

export interface IMusicArtistIds {
    artistId: string | null;
    artistMid: string | null;
    artistName: string | null;
}

/** QQ singer mid looks like "000jNiaT2aHJb9" (has letters); pure digits are singer id, not mid. */
function isQqSingerMid(value: string | null | undefined): boolean {
    if (!value) {
        return false;
    }
    const text = String(value).trim();
    return text.length >= 8 && /[A-Za-z]/.test(text);
}

/** Best-effort avatar URL when plugins omit singerList.avatar (esp. QQ mid). */
function resolveArtistAvatar(
    platform: string | null | undefined,
    entry: Pick<IMusicArtistEntry, "artistId" | "artistMid" | "avatar">,
): string | null {
    const existing = nonEmpty(entry.avatar);
    if (existing) {
        // Netease default placeholder is useless as cover
        if (existing.includes("5639395138885805")) {
            // fall through
        } else {
            return existing;
        }
    }
    const p = (platform ?? "").toLowerCase();
    const mid = entry.artistMid || (isQqSingerMid(entry.artistId) ? entry.artistId : null);
    // QQ singer cover needs mid (not numeric singer id)
    if ((p.includes("qq") || (platform ?? "").includes("QQ")) && mid && isQqSingerMid(mid)) {
        return `https://y.gtimg.cn/music/photo_new/T001R500x500M000${mid}.jpg`;
    }
    return null;
}

function normalizeSingerEntry(raw: unknown): IMusicArtistEntry | null {
    if (raw == null) {
        return null;
    }
    if (typeof raw === "string" || typeof raw === "number") {
        const name = nonEmpty(raw);
        return name
            ? { name, artistId: null, artistMid: null, avatar: null }
            : null;
    }
    if (typeof raw !== "object") {
        return null;
    }
    const entry = raw as Record<string, unknown>;
    const name = pickFirst(
        entry.name,
        entry.singerName,
        entry.artist,
        entry.author_name,
        entry.authorName,
    );
    const artistId = pickFirst(
        entry.id,
        entry.singerid,
        entry.singerId,
        entry.singer_id,
        entry.singerID,
        entry.artistId,
        entry.artistid,
        entry.artist_id,
        entry.author_id,
        entry.authorId,
    );
    const artistMid = pickFirst(
        entry.mid,
        entry.pmid,
        entry.singerMID,
        entry.singerMid,
        entry.singermid,
        entry.singer_mid,
        entry.artistMid,
        entry.artistmid,
    );
    const avatar = pickFirst(
        entry.avatar,
        entry.img,
        entry.picUrl,
        entry.img1v1Url,
        entry.singerPic,
        entry.artistPic,
        entry.face,
        entry.pic,
        entry.cover,
        entry.headPic,
    );
    if (!name && !artistId && !artistMid) {
        return null;
    }
    return { name, artistId, artistMid, avatar };
}

function collectSingerList(item: Record<string, unknown>): unknown[] {
    if (Array.isArray(item.singerList) && item.singerList.length) {
        return item.singerList;
    }
    if (Array.isArray(item.artists) && item.artists.length) {
        return item.artists;
    }
    if (Array.isArray(item.ar) && item.ar.length) {
        return item.ar;
    }
    if (Array.isArray(item.singer) && item.singer.length) {
        return item.singer;
    }
    if (Array.isArray(item.singers) && item.singers.length) {
        return item.singers;
    }
    if (Array.isArray(item.authors) && item.authors.length) {
        return item.authors;
    }
    return [];
}

/** Multi-artist joined fields (Kuwo/Joox/…): "A&B" / "A, B" / "A/B" + ids "id1&id2". */
const MULTI_ARTIST_SPLIT = /\s*(?:&|＆|\+|·|•|feat\.?|ft\.?|,|，|、|\/|／)\s*/i;

function looksLikeMultiArtistJoined(text: string | null | undefined): boolean {
    if (!text) {
        return false;
    }
    return MULTI_ARTIST_SPLIT.test(text);
}

function splitMultiArtistField(text: string | null): string[] {
    if (!text) {
        return [];
    }
    return text
        .split(MULTI_ARTIST_SPLIT)
        .map((part) => part.trim())
        .filter(Boolean);
}

/**
 * Expand a single joined artist entry ("A&B", id "1&2") into multiple.
 * Kuwo plugins historically packed multi-singers into one singerList row.
 */
function expandJoinedArtistEntries(entries: IMusicArtistEntry[]): IMusicArtistEntry[] {
    if (entries.length !== 1) {
        return entries;
    }
    const only = entries[0];
    const nameJoined = looksLikeMultiArtistJoined(only.name);
    const idJoined = looksLikeMultiArtistJoined(only.artistId);
    if (!nameJoined && !idJoined) {
        return entries;
    }
    const names = splitMultiArtistField(only.name);
    const ids = splitMultiArtistField(only.artistId);
    const count = Math.max(names.length, ids.length);
    if (count <= 1) {
        return entries;
    }
    return Array.from({ length: count }, (_, index) => ({
        name: names[index] || null,
        artistId: ids[index] || null,
        artistMid: index === 0 ? only.artistMid : null,
        avatar: index === 0 ? only.avatar : null,
    }));
}

/** All artists on a track (singerList / ar / top-level fields). */
export function getMusicArtists(musicItem: IMusic.IMusicItemPartial): IMusicArtistEntry[] {
    const item = musicItem as Record<string, unknown>;
    const fromList = collectSingerList(item)
        .map(normalizeSingerEntry)
        .filter((entry): entry is IMusicArtistEntry => entry != null);

    if (fromList.length > 0) {
        // When plugins only fill id/mid on the first singer, still keep every name.
        // If top-level has a single id and list entries lack ids entirely, attach to first.
        const anyListId = fromList.some((entry) => entry.artistId || entry.artistMid);
        if (!anyListId) {
            const topId = pickFirst(
                item.artistId,
                item.artistid,
                item.artist_id,
                item.singerId,
                item.singerid,
                item.singer_id,
                item.singerID,
            );
            const topMid = pickFirst(
                item.artistMid,
                item.artistmid,
                item.singerMID,
                item.singerMid,
                item.singermid,
                item.singer_mid,
            );
            if (topId || topMid) {
                fromList[0] = {
                    ...fromList[0],
                    artistId: fromList[0].artistId || topId,
                    artistMid: fromList[0].artistMid || topMid,
                };
            }
        }
        return expandJoinedArtistEntries(fromList);
    }

    // Fallback: scalar artist / artistId — also split Kuwo-style joined fields.
    const artistName = pickFirst(musicItem.artist);
    const artistId = pickFirst(
        item.artistId,
        item.artistid,
        item.artist_id,
        item.singerId,
        item.singerid,
        item.singer_id,
        item.singerID,
    );
    const artistMid = pickFirst(
        item.artistMid,
        item.artistmid,
        item.singerMID,
        item.singerMid,
        item.singermid,
        item.singer_mid,
    );
    if (!artistName && !artistId && !artistMid) {
        return [];
    }
    return expandJoinedArtistEntries([
        { name: artistName, artistId, artistMid, avatar: null },
    ]);
}

export function getMusicArtistIds(musicItem: IMusic.IMusicItemPartial): IMusicArtistIds {
    const artists = getMusicArtists(musicItem);
    const first = artists[0];
    const joinedNames = artists
        .map((entry) => entry.name)
        .filter((name): name is string => !!name)
        .join(", ");
    return {
        artistId: first?.artistId ?? null,
        artistMid: first?.artistMid ?? null,
        artistName: pickFirst(musicItem.artist, joinedNames || null),
    };
}

/** Display: "A, B, C (id: …, mid: …)" — all names outside; first artist's ids inside. */
export function formatMusicArtistTitle(
    musicItem: IMusic.IMusicItemPartial,
    unknownLabel: string,
): string {
    const artists = getMusicArtists(musicItem);
    if (!artists.length) {
        return unknownLabel;
    }

    const joinedFromList = artists
        .map((entry) => entry.name)
        .filter((name): name is string => !!name)
        .join(", ");
    const names = pickFirst(musicItem.artist, joinedFromList) || unknownLabel;

    // Parentheses: first artist only — labeled ids, no name.
    const first = artists[0];
    const pairText = formatIdPairs([
        ["id", first?.artistId ?? null],
        [
            "mid",
            first?.artistMid && first.artistMid !== first.artistId
                ? first.artistMid
                : null,
        ],
    ]);

    if (!pairText) {
        return names;
    }
    return `${names} (${pairText})`;
}

function artistEntryToCopyRow(entry: IMusicArtistEntry): Record<string, string> {
    const row: Record<string, string> = {};
    if (entry.name) {
        row.name = entry.name;
    }
    if (entry.artistId) {
        row.artistId = entry.artistId;
    }
    if (entry.artistMid && entry.artistMid !== entry.artistId) {
        row.artistMid = entry.artistMid;
    }
    return row;
}

export function buildMusicArtistCopyPayload(musicItem: IMusic.IMusicItemPartial): string {
    const artists = getMusicArtists(musicItem);
    if (!artists.length) {
        return "";
    }

    const joinedFromList = artists
        .map((entry) => entry.name)
        .filter((name): name is string => !!name)
        .join(", ");
    const joinedName = pickFirst(musicItem.artist, joinedFromList) ?? "";
    const hasAnyId = artists.some((entry) => entry.artistId || entry.artistMid);

    // No ids → plain name string.
    if (!hasAnyId) {
        return joinedName;
    }

    // Clean shape: platform + artists[{name, artistId, artistMid}]
    return JSON.stringify({
        platform: String(musicItem.platform ?? ""),
        artists: artists.map(artistEntryToCopyRow),
    });
}

/** Build navigable artist item (id/mid required). QQ plugins read singerMID. */
export function buildArtistItemFromEntry(
    musicItem: IMusic.IMusicItemPartial,
    entry: IMusicArtistEntry,
): IArtist.IArtistItem | null {
    const platform = nonEmpty(musicItem.platform);
    const id = entry.artistId || entry.artistMid;
    if (!platform || !id) {
        return null;
    }
    const mid = entry.artistMid || (isQqSingerMid(entry.artistId) ? entry.artistId : null);
    const artistItem: IArtist.IArtistItem = {
        id: String(id),
        name: entry.name || "",
        platform,
        avatar: resolveArtistAvatar(platform, entry) || "",
    };
    if (mid) {
        // Used by QQ getArtistWorks / avatar URL
        (artistItem as IArtist.IArtistItem & { singerMID?: string }).singerMID = mid;
        (artistItem as IArtist.IArtistItem & { mid?: string }).mid = mid;
    }
    return artistItem;
}

export function getNavigableArtists(
    musicItem: IMusic.IMusicItemPartial,
): Array<{ entry: IMusicArtistEntry; artistItem: IArtist.IArtistItem }> {
    return getMusicArtists(musicItem)
        .map((entry) => {
            const artistItem = buildArtistItemFromEntry(musicItem, entry);
            return artistItem ? { entry, artistItem } : null;
        })
        .filter(
            (item): item is { entry: IMusicArtistEntry; artistItem: IArtist.IArtistItem } =>
                item != null,
        );
}

/** Build navigable album item (albumId/mid required). QQ plugins read albumMID. */
export function buildAlbumItemFromMusic(
    musicItem: IMusic.IMusicItemPartial,
): IAlbum.IAlbumItem | null {
    const platform = nonEmpty(musicItem.platform);
    const { albumId, albumMid, albumName } = getMusicAlbumIds(musicItem);
    const id = albumId || albumMid;
    if (!platform || !id) {
        return null;
    }
    const albumItem: IAlbum.IAlbumItem = {
        id: String(id),
        platform,
        title: albumName || "",
        description: "",
        artist: nonEmpty(musicItem.artist) || undefined,
        artwork: nonEmpty(musicItem.artwork) || undefined,
    };
    if (albumMid) {
        (albumItem as IAlbum.IAlbumItem & { albumMID?: string }).albumMID = albumMid;
        (albumItem as IAlbum.IAlbumItem & { albummid?: string }).albummid = albumMid;
    }
    if (albumId) {
        (albumItem as IAlbum.IAlbumItem & { albumId?: string }).albumId = albumId;
    }
    return albumItem;
}

export interface IMusicAlbumIds {
    albumId: string | null;
    albumMid: string | null;
    albumName: string | null;
}

export function getMusicAlbumIds(musicItem: IMusic.IMusicItemPartial): IMusicAlbumIds {
    const item = musicItem as Record<string, unknown>;
    const albumObj = item.album && typeof item.album === "object"
        ? item.album as Record<string, unknown>
        : null;

    return {
        albumId: pickFirst(
            item.albumid,
            item.albumId,
            item.album_id,
            item.AlbumID,
            albumObj?.id,
        ),
        albumMid: pickFirst(
            item.albummid,
            item.albumMid,
            item.album_mid,
            albumObj?.mid,
        ),
        albumName: pickFirst(
            typeof item.album === "string" ? item.album : null,
            albumObj?.name,
            albumObj?.title,
        ),
    };
}

export function formatMusicAlbumTitle(
    musicItem: IMusic.IMusicItemPartial,
    unknownLabel: string,
): string {
    const { albumId, albumMid, albumName } = getMusicAlbumIds(musicItem);
    const name = albumName || unknownLabel;
    const pairText = formatIdPairs([
        ["id", albumId],
        ["mid", albumMid && albumMid !== albumId ? albumMid : null],
    ]);
    return pairText ? `${name} (${pairText})` : name;
}

export function buildMusicAlbumCopyPayload(musicItem: IMusic.IMusicItemPartial): string {
    const { albumId, albumMid, albumName } = getMusicAlbumIds(musicItem);
    if (!albumId && !albumMid) {
        return albumName || "";
    }
    const payload: Record<string, string> = {
        platform: String(musicItem.platform ?? ""),
    };
    if (albumName) {
        payload.album = albumName;
    }
    if (albumId) {
        payload.albumId = albumId;
    }
    if (albumMid) {
        payload.albumMid = albumMid;
    }
    return JSON.stringify(payload);
}

/** Host-side fallback when plugin has no getMusicDetailPageUrl. */
export function buildFallbackMusicDetailUrl(musicItem: IMusic.IMusicItemPartial): string {
    const platform = String(musicItem.platform ?? "");
    const p = platform.toLowerCase();
    const item = musicItem as Record<string, unknown>;
    const pick = (...values: unknown[]) => pickFirst(...values) ?? "";

    if (p.includes("qq") || platform.includes("QQ")) {
        const mid = pick(
            item.songmid,
            item.mid,
            item.songMid,
            item.media_mid,
            item.mediaMid,
        );
        if (mid) {
            return `https://y.qq.com/n/ryqq/songDetail/${mid}`;
        }
        const songid = pick(item.songid, item.songId, item.id);
        return songid ? `https://i.y.qq.com/v8/playsong.html?songid=${songid}` : "";
    }

    if (platform.includes("酷我") || p.includes("kuwo")) {
        let rid = pick(item.songmid, item.mid, item.rid, item.musicrid, item.id);
        rid = rid.replace(/^MUSIC_/i, "");
        return rid ? `https://www.kuwo.cn/play_detail/${rid}` : "";
    }

    if (platform.includes("酷狗") || p.includes("kugou")) {
        const hash = pick(item.hash, item.FileHash, item.fileHash, item.id);
        if (!hash) {
            return "";
        }
        const albumId = pick(item.albumId, item.album_id, item.albumid, item.AlbumID) || "0";
        return `https://www.kugou.com/song/#hash=${hash}&album_id=${albumId}`;
    }

    if (platform.includes("咪咕") || p.includes("migu")) {
        const cid = pick(
            item.copyrightId,
            item.copyright_id,
            item.contentId,
            item.content_id,
            item.id,
        );
        return cid ? `https://music.migu.cn/v3/music/song/${cid}` : "";
    }

    if (platform.includes("网易") || p.includes("netease") || p.includes("wy")) {
        const id = pick(item.songmid, item.id);
        return id ? `https://music.163.com/#/song?id=${id}` : "";
    }

    if (platform.includes("汽水") || p.includes("qishui") || p.includes("douyin")) {
        const id = pick(item.id, item.track_id, item.trackId);
        return id
            ? `https://music.douyin.com/qishui/share/track?track_id=${id}`
            : "";
    }

    if (p.includes("bilibili") || platform.includes("B站") || platform.includes("哔哩")) {
        const bvid = pick(item.bvid, item.bvId);
        if (bvid) {
            return `https://www.bilibili.com/video/${bvid}`;
        }
        const aid = pick(item.aid, item.avid, item.id);
        return aid ? `https://www.bilibili.com/video/av${aid}` : "";
    }

    return "";
}

export async function formatMusicSharePayload(
    musicItem: IMusic.IMusicItemPartial,
    resolveDetailUrl?: (item: IMusic.IMusicItemPartial) => Promise<string | null | undefined>,
): Promise<{ message: string; url?: string; musicTitle: string }> {
    const title = nonEmpty(musicItem.title);
    const artist = nonEmpty(musicItem.artist);
    const musicTitle =
        title && artist
            ? `${title} - ${artist}`
            : title || artist || String(musicItem.id ?? "");

    let detailUrl = "";
    if (resolveDetailUrl) {
        try {
            detailUrl = (await resolveDetailUrl(musicItem))?.trim() || "";
        } catch {
            detailUrl = "";
        }
    }
    if (!detailUrl) {
        detailUrl = buildFallbackMusicDetailUrl(musicItem);
    }

    const message = detailUrl ? `${musicTitle}\n${detailUrl}` : musicTitle;
    return {
        message,
        url: detailUrl || undefined,
        musicTitle,
    };
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
    if (!text) {
        return false;
    }
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fall through
    }
    try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        return ok;
    } catch {
        return false;
    }
}

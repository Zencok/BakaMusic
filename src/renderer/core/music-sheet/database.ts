import { musicRefSymbol } from "@/common/constant";
import Dexie, { type Table } from "dexie";

export interface ISheetMusicRelation {
    sheetId: string;
    platform: string;
    musicId: string;
    position: number;
    addedAt: number;
    batchIndex: number;
}

export type IStoredMusicItem = IMusic.IMusicItem & {
    [musicRefSymbol]: number;
};

class MusicSheetDB extends Dexie {
    /** `sheet` entity: metadata only; tracks live in `sheetMusic`. */
    sheets!: Table<IMusic.IDBMusicSheetItem, string>;
    /** `music` entity shared by sheets and the downloaded library. */
    musicStore!: Table<IStoredMusicItem, [string, string]>;
    /** Normalized `sheet_music` relation. */
    sheetMusic!: Table<ISheetMusicRelation, [string, string, string]>;
    localMusicStore!: Table<IMusic.IMusicItem & {
        $$localPath: string;
    }, [string, string]>;

    constructor() {
        super("musicSheetDB");
        this.version(1.1).stores({
            sheets: "&id, title, artist, createAt, $$sortIndex",
            musicStore: "[platform+id], title, artist, album",
            localMusicStore: "[platform+id], title, artist, album, $$localPath",
        });

        this.version(2).stores({
            sheets: "&id, title, artist, createAt, $$sortIndex",
            musicStore: "[platform+id], title, artist, album",
            sheetMusic:
                "[sheetId+platform+musicId], sheetId, [sheetId+position], [platform+musicId]",
            localMusicStore: "[platform+id], title, artist, album, $$localPath",
        }).upgrade(async (transaction) => {
            const sheetTable = transaction.table<IMusic.IDBMusicSheetItem, string>(
                "sheets",
            );
            const relationTable = transaction.table<
                ISheetMusicRelation,
                [string, string, string]
            >("sheetMusic");
            const sheets = await sheetTable.toArray();
            const relations: ISheetMusicRelation[] = [];
            const normalizedSheets = sheets.map((sheet) => {
                (sheet.musicList ?? []).forEach((musicItem, position) => {
                    relations.push({
                        sheetId: sheet.id,
                        platform: musicItem.platform,
                        musicId: musicItem.id,
                        position,
                        addedAt: Number(musicItem.$$addedAt ?? sheet.createAt ?? 0),
                        batchIndex: Number(musicItem.$$batchIndex ?? position),
                    });
                });

                const metadata = { ...sheet };
                delete metadata.musicList;
                return metadata;
            });

            if (relations.length) {
                await relationTable.bulkPut(relations);
            }
            if (normalizedSheets.length) {
                await sheetTable.bulkPut(normalizedSheets);
            }
        });
    }
}

const musicSheetDB = new MusicSheetDB();
export default musicSheetDB;

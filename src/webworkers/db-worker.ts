import * as Comlink from "comlink";
import { safeParse } from "@/common/safe-serialization";
import Database from "better-sqlite3";

const dbPath = "";
const database = new Database(dbPath);
database.pragma("journal_mode = WAL");

function getSheetItem(sheetId: string): IMusic.IMusicSheetItem | null {
    try {
        const queryMusicListSql = database.prepare<[], IMusic.IMusicItem>(
            `SELECT * from "main"."${`SHEET_MUSICLIST_${sheetId}`}"
              ORDER BY
              "$sortIndex" DESC
              `,
        );
        const sheetItem = database
            .prepare<[string], IMusic.IMusicSheetItem>(
                "SELECT * from \"main\".\"localMusicSheets\" where id = ?",
            )
            .get(sheetId);
        return {
            platform: sheetItem.platform,
            id: sheetItem.id,
            title: sheetItem.title,
            artwork: sheetItem.artwork,
            description: sheetItem.description,
            createAt: sheetItem.createAt,
            musicList: queryMusicListSql.all().map((it: any) => ({
                ...it,
                $raw: safeParse(it.raw),
            })),
            worksNum: sheetItem.worksNum,
        };
    } catch {
        return null;
    }
}

Comlink.expose({
    getSheetItem,
});

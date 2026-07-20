import MusicSheet from "../music-sheet";
import { parseBackupPayload } from "./format";

/** Validate and restore all sheets in one database transaction. */
async function resume(
    data: string | Record<string, unknown>,
    overwrite = false,
) {
    const musicSheets = parseBackupPayload(data);
    await MusicSheet.frontend.restoreSheetDetails(musicSheets, overwrite);
}

const BackupResume = { resume };
export default BackupResume;
export {
    createBackupFileName,
    createBackupPayload,
    parseBackupPayload,
} from "./format";

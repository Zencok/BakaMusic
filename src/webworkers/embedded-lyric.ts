import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { readTags, writeTags } from "@/common/taglib-native";

async function readEmbeddedLyric(filePath: string) {
    const tags = readTags(filePath, {
        duration: false,
        skipCovers: true,
    });
    return tags.lyrics ?? "";
}

async function writeEmbeddedLyricTag(filePath: string, lyricContent: string) {
    // TagLib write path clears residual SYLT on MPEG and replaces USLT/LYRICS.
    writeTags(filePath, {
        lyrics: lyricContent,
    });
}

/**
 * Update only the lyric tag. A same-directory backup is retained until the
 * save and read-back verification both finish, then removed.
 */
export async function overwriteEmbeddedLyric(
    filePath: string,
    lyricContent: string,
) {
    if (!lyricContent.trim()) {
        throw new Error("Embedded lyric content is empty");
    }

    const backupPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.bakamusic-lyric-${randomUUID()}.bak`,
    );
    let shouldRemoveBackup = false;

    await fs.copyFile(filePath, backupPath, fs.constants.COPYFILE_EXCL);
    try {
        await writeEmbeddedLyricTag(filePath, lyricContent);
        const persistedLyric = await readEmbeddedLyric(filePath);
        if (persistedLyric.trim() !== lyricContent.trim()) {
            throw new Error("Embedded lyric verification failed");
        }
        shouldRemoveBackup = true;
    } catch (writeError) {
        try {
            await fs.copyFile(backupPath, filePath);
            shouldRemoveBackup = true;
        } catch (restoreError) {
            throw new AggregateError(
                [writeError, restoreError],
                `Embedded lyric update failed; backup kept at ${backupPath}`,
            );
        }
        throw writeError;
    } finally {
        if (shouldRemoveBackup) {
            await fs.rm(backupPath, { force: true });
        }
    }
}

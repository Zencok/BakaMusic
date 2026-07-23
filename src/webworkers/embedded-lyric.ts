import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";

async function readEmbeddedLyric(filePath: string) {
    const { File: TagLibFile } = await import("node-taglib-sharp");
    const songFile = TagLibFile.createFromPath(filePath);

    try {
        return songFile.tag.lyrics ?? "";
    } finally {
        songFile.dispose();
    }
}

async function writeEmbeddedLyricTag(filePath: string, lyricContent: string) {
    const {
        File: TagLibFile,
        Id3v2FrameIdentifiers,
        Id3v2Settings,
        TagTypes,
    } = await import("node-taglib-sharp");

    if (path.extname(filePath).toLowerCase() === ".mp3") {
        Id3v2Settings.forceDefaultVersion = true;
        Id3v2Settings.defaultVersion = 3;
    } else {
        Id3v2Settings.forceDefaultVersion = false;
    }

    const songFile = TagLibFile.createFromPath(filePath);
    try {
        const id3v2Tag = songFile.getTag(TagTypes.Id3v2, false) as unknown as
            | {
                removeFrames: (
                    identifier: (typeof Id3v2FrameIdentifiers)["SYLT"],
                ) => void;
            }
            | undefined;
        if (id3v2Tag) {
            // `tag.lyrics` writes USLT but leaves old synchronized SYLT
            // frames behind. music-metadata exposes both, and the old SYLT
            // can otherwise win as hundreds of one-word lyric lines.
            id3v2Tag.removeFrames(Id3v2FrameIdentifiers.SYLT);
            id3v2Tag.removeFrames(Id3v2FrameIdentifiers.USLT);
        }
        songFile.tag.lyrics = lyricContent;
        songFile.save();
    } finally {
        songFile.dispose();
    }
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

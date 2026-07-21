interface IDownloadProgress {
    downloaded?: number;
    total?: number;
}

export function getDownloadProgressPercent(progress: IDownloadProgress | null) {
    if (
        !progress
        || typeof progress.downloaded !== "number"
        || !Number.isFinite(progress.downloaded)
        || typeof progress.total !== "number"
        || !Number.isFinite(progress.total)
        || progress.total <= 0
    ) {
        return 0;
    }

    return Math.min(100, Math.max(0, progress.downloaded / progress.total * 100));
}

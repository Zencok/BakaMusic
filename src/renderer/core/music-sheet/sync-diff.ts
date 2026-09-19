import type { ISheetMusicRelation } from "./database";
import { importTrackKey } from "./import-sync";

/** Keep a longest increasing subsequence of positions; only moved/new rows get new positions. */
export function sparseSyncPositions(oldPositions: (number | undefined)[]): number[] {
    const tails: number[] = [];
    const parents = new Array<number>(oldPositions.length).fill(-1);
    oldPositions.forEach((position, index) => {
        if (position === undefined || !Number.isFinite(position)) {
            return;
        }
        let low = 0;
        let high = tails.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if ((oldPositions[tails[middle]] as number) < position) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        parents[index] = low ? tails[low - 1] : -1;
        tails[low] = index;
    });
    const anchors: number[] = [];
    for (let index = tails[tails.length - 1] ?? -1; index >= 0; index = parents[index]) {
        anchors.push(index);
    }
    anchors.reverse();
    const result: number[] = [];
    let left = -1;
    for (const right of [...anchors, oldPositions.length]) {
        const leftValue = left >= 0 ? result[left] : undefined;
        const rightValue = right < oldPositions.length ? oldPositions[right] : undefined;
        for (let index = left + 1; index < right; index++) {
            result[index] = leftValue !== undefined && rightValue !== undefined
                ? leftValue + (rightValue - leftValue) * ((index - left) / (right - left))
                : rightValue !== undefined ? rightValue - (right - index)
                    : (leftValue ?? -1) + index - left;
        }
        if (rightValue !== undefined) {
            result[right] = rightValue;
        }
        left = right;
    }
    // Rebalance only when fractional gaps run out of floating-point precision.
    return result.some((position, index) => !Number.isFinite(position) || (index > 0 && position <= result[index - 1]))
        ? oldPositions.map((_position, index) => index)
        : result;
}

export function equalSourceKeys(left: string[] = [], right: string[] = []) {
    if (left.length !== right.length) {
        return false;
    }
    const keys = new Set(left);
    return right.every((key) => keys.has(key));
}

export function diffSyncRelations(
    sheetId: string,
    previous: ISheetMusicRelation[],
    tracks: IMedia.IMediaBase[],
    ownership: IMusic.ISheetTrackOwnership[],
) {
    const previousByKey = new Map(previous.map((row) => [importTrackKey({ platform: row.platform, id: row.musicId }), row]));
    const keys = tracks.map(importTrackKey);
    const nextKeys = new Set(keys);
    const positions = sparseSyncPositions(keys.map((key) => previousByKey.get(key)?.position));
    const deleted = previous.filter((row) => {
        const key = importTrackKey({ platform: row.platform, id: row.musicId });
        return !nextKeys.has(key) || previousByKey.get(key) !== row;
    });
    const inserted: ISheetMusicRelation[] = [];
    const updated: ISheetMusicRelation[] = [];
    tracks.forEach((track, index) => {
        const old = previousByKey.get(keys[index]);
        const owner = ownership[index];
        const row: ISheetMusicRelation = {
            sheetId, platform: track.platform, musicId: old?.musicId ?? track.id,
            position: positions[index], addedAt: old?.addedAt ?? Date.now(),
            batchIndex: old?.batchIndex ?? index, manual: owner.manual, sourceKeys: owner.sourceKeys,
        };
        if (!old) {
            inserted.push(row);
        } else if (old.position !== row.position || old.manual !== row.manual || !equalSourceKeys(old.sourceKeys, row.sourceKeys)) {
            updated.push(row);
        }
    });
    return { inserted, updated, deleted };
}

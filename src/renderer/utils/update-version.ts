import { compare } from "compare-versions";

export function shouldShowAvailableUpdate(
    availableVersion: string,
    skippedVersion: string | null,
    forceCheck: boolean,
): boolean {
    if (forceCheck || !skippedVersion) {
        return true;
    }

    return compare(availableVersion, skippedVersion, ">");
}

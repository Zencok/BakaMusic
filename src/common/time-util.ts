export function parseDurationSeconds(duration?: number | string | null) {
    if (typeof duration === "number") {
        if (Number.isFinite(duration) && duration >= 0) {
            return duration;
        }
        return undefined;
    }

    if (typeof duration !== "string") {
        return undefined;
    }

    const trimmedDuration = duration.trim();
    if (!trimmedDuration) {
        return undefined;
    }

    if (/^\d+(?:\.\d+)?$/.test(trimmedDuration)) {
        const parsedNumber = Number(trimmedDuration);
        return Number.isFinite(parsedNumber) ? parsedNumber : undefined;
    }

    const timeParts = trimmedDuration.split(":");
    if (
        timeParts.length >= 2 &&
        timeParts.length <= 3 &&
        timeParts.every((part) => /^\d+$/.test(part))
    ) {
        return timeParts.reduce((totalSeconds, currentPart) => {
            return totalSeconds * 60 + Number(currentPart);
        }, 0);
    }

    return undefined;
}

export function secondsToDuration(seconds: number | string) {
    const normalizedSeconds = parseDurationSeconds(seconds);
    if (normalizedSeconds === undefined) {
        return typeof seconds === "string" ? seconds : "00:00";
    }

    const flooredSeconds = Math.floor(normalizedSeconds);
    const sec = flooredSeconds % 60;
    const totalMinutes = Math.floor(flooredSeconds / 60);
    const min = totalMinutes % 60;
    const hour = Math.floor(totalMinutes / 60);
    const ms = `${min}`.padStart(2, "0") + ":" + `${sec}`.padStart(2, "0");
    if (hour === 0) {
        return ms;
    } else {
        return `${hour}:${ms}`;
    }
}

export function delay(millsecond: number) {
    return new Promise<void>((resolve) => {
        setTimeout(() => {
            resolve();
        }, millsecond);
    });
}

export function toError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }

    if (typeof error === "string") {
        return new Error(error);
    }

    try {
        return new Error(JSON.stringify(error));
    } catch {
        return new Error(String(error));
    }
}

export function getErrorMessage(error: unknown): string {
    return toError(error).message;
}

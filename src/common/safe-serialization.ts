export function safeStringify(object: object) {
    try {
        return JSON.stringify(object);
    } catch {
        return "";
    }
}

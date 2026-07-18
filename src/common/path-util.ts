function usesWindowsSyntax(filePath: string) {
    return /^[A-Za-z]:[/\\]/.test(filePath)
        || filePath.startsWith("\\\\")
        || filePath.includes("\\");
}

interface ParsedPath {
    root: string;
    segments: string[];
    windows: boolean;
}

function parsePath(filePath: string): ParsedPath {
    const windows = usesWindowsSyntax(filePath);
    const normalizedSeparators = filePath.replaceAll("\\", "/");
    let root = "";
    let remainder = normalizedSeparators;

    const driveMatch = remainder.match(/^([A-Za-z]:)(?:\/|$)/);
    if (driveMatch) {
        root = `${driveMatch[1]}/`;
        remainder = remainder.slice(driveMatch[0].length);
    } else if (remainder.startsWith("//")) {
        const uncParts = remainder.slice(2).split("/").filter(Boolean);
        if (uncParts.length >= 2) {
            root = `//${uncParts[0]}/${uncParts[1]}/`;
            remainder = uncParts.slice(2).join("/");
        } else {
            root = "//";
            remainder = uncParts.join("/");
        }
    } else if (remainder.startsWith("/")) {
        root = "/";
        remainder = remainder.replace(/^\/+/, "");
    }

    const segments: string[] = [];
    for (const segment of remainder.split("/")) {
        if (!segment || segment === ".") {
            continue;
        }
        if (segment === "..") {
            if (segments.length && segments[segments.length - 1] !== "..") {
                segments.pop();
            } else if (!root) {
                segments.push(segment);
            }
            continue;
        }
        segments.push(segment);
    }
    return { root, segments, windows };
}

function formatPath(parsed: ParsedPath) {
    const separator = parsed.windows ? "\\" : "/";
    const root = parsed.windows ? parsed.root.replaceAll("/", "\\") : parsed.root;
    const body = parsed.segments.join(separator);
    if (!root) {
        return body || ".";
    }
    return `${root}${body}`.replace(
        parsed.windows ? /\\$/ : /\/$/,
        body ? "" : separator,
    );
}

export function normalizeFilePath(filePath: string) {
    return formatPath(parsePath(filePath));
}

export function isAbsoluteFilePath(filePath: string) {
    return Boolean(parsePath(filePath).root);
}

export function resolveFilePath(...parts: string[]) {
    let combined = "";
    for (const part of parts) {
        if (!part) {
            continue;
        }
        if (isAbsoluteFilePath(part)) {
            combined = part;
        } else {
            combined = combined ? `${combined}/${part}` : part;
        }
    }
    return normalizeFilePath(combined);
}

export function dirnameFilePath(filePath: string) {
    const parsed = parsePath(filePath);
    parsed.segments.pop();
    return formatPath(parsed);
}

export function extnameFilePath(filePath: string) {
    const leaf = filePath.replaceAll("\\", "/").split("/").pop() ?? "";
    const dotIndex = leaf.lastIndexOf(".");
    return dotIndex > 0 ? leaf.slice(dotIndex) : "";
}

export function relativeFilePath(from: string, to: string) {
    const source = parsePath(normalizeFilePath(from));
    const target = parsePath(normalizeFilePath(to));
    const sourceRoot = source.windows ? source.root.toLocaleLowerCase() : source.root;
    const targetRoot = target.windows ? target.root.toLocaleLowerCase() : target.root;
    if (sourceRoot !== targetRoot) {
        return normalizeFilePath(to);
    }
    let commonLength = 0;
    while (commonLength < source.segments.length && commonLength < target.segments.length) {
        const sourcePart = source.windows
            ? source.segments[commonLength].toLocaleLowerCase()
            : source.segments[commonLength];
        const targetPart = target.windows
            ? target.segments[commonLength].toLocaleLowerCase()
            : target.segments[commonLength];
        if (sourcePart !== targetPart) {
            break;
        }
        commonLength++;
    }
    const segments = [
        ...Array.from({ length: source.segments.length - commonLength }, () => ".."),
        ...target.segments.slice(commonLength),
    ];
    return segments.join(source.windows || target.windows ? "\\" : "/") || "";
}

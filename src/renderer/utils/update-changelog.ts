function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function normalizeHttpUrl(value: string): string | null {
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null;
        }
        return url.href;
    } catch {
        return null;
    }
}

function formatInlineText(value: string): string {
    return escapeHtml(value)
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>");
}

function renderInline(value: string): string {
    const segments: string[] = [];
    const linkPattern = /\[([^\]\r\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = linkPattern.exec(value)) !== null) {
        if (match.index > lastIndex) {
            segments.push(formatInlineText(value.slice(lastIndex, match.index)));
        }

        const rawUrl = match[2] ?? match[3];
        const url = normalizeHttpUrl(rawUrl);
        if (url) {
            const label = match[1] ?? match[3];
            segments.push(
                `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">` +
                `${formatInlineText(label)}</a>`,
            );
        } else {
            segments.push(formatInlineText(match[0]));
        }
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < value.length) {
        segments.push(formatInlineText(value.slice(lastIndex)));
    }
    return segments.join("");
}

function renderLine(rawLine: string): string {
    const line = rawLine.trim();
    if (!line) {
        return "";
    }

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
        return `<strong>${renderInline(heading[1])}</strong>`;
    }

    const listItem = line.match(/^[*+-]\s+(.+)$/);
    if (listItem) {
        return `<li>${renderInline(listItem[1])}</li>`;
    }

    return `<p>${renderInline(line)}</p>`;
}

export function renderUpdateChangelog(lines: string[]): string {
    return lines
        .flatMap((line) => line.split("\n"))
        .map(renderLine)
        .filter(Boolean)
        .join("\n")
        .replace(/(<li>.*<\/li>\n?)+/g, (listItems) => `<ul>${listItems}</ul>`);
}

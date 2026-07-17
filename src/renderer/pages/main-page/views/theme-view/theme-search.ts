export interface IThemeSearchTarget {
    name?: string;
    author?: string;
    description?: string;
    id?: string;
    version?: string;
}

function normalizeSearchValue(value: string) {
    return value.normalize("NFKC").toLocaleLowerCase();
}

export function matchesThemeSearch(
    theme: IThemeSearchTarget,
    query: string,
    aliases: ReadonlyArray<string | undefined> = [],
) {
    const searchTokens = normalizeSearchValue(query.trim()).split(/\s+/).filter(Boolean);
    if (!searchTokens.length) {
        return true;
    }

    const searchableText = [
        theme.name,
        theme.author,
        theme.description,
        theme.id,
        theme.version,
        ...aliases,
    ]
        .filter((value): value is string => Boolean(value))
        .map(normalizeSearchValue)
        .join("\n");

    return searchTokens.every((token) => searchableText.includes(token));
}

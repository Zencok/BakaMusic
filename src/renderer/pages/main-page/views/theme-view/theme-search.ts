import { matchesSearchValues } from "../../../../../common/search-matcher";

export interface IThemeSearchTarget {
    name?: string;
    author?: string;
    description?: string;
    id?: string;
    version?: string;
}

export function matchesThemeSearch(
    theme: IThemeSearchTarget,
    query: string,
    aliases: ReadonlyArray<string | undefined> = [],
) {
    return matchesSearchValues([
        theme.name,
        theme.author,
        theme.description,
        theme.id,
        theme.version,
        ...aliases,
    ], query);
}

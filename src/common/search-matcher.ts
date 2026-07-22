import OpenCC from "opencc-js/t2cn";

export type SearchableValue = string | number | null | undefined;

export interface ISearchMatchOptions {
    caseSensitive?: boolean;
}

const traditionalToSimplified = OpenCC.Converter({
    from: "t",
    to: "cn",
});
const combiningMarksPattern = /\p{M}+/gu;
const compactSeparatorsPattern = /[\p{P}\p{S}\s]+/gu;

export function normalizeSearchValue(
    value: SearchableValue,
    options: ISearchMatchOptions = {},
) {
    if (value === null || value === undefined) {
        return "";
    }

    const compatibleText = String(value).normalize("NFKC");
    const simplifiedText = traditionalToSimplified(compatibleText)
        .normalize("NFKD")
        .replace(combiningMarksPattern, "");
    return (options.caseSensitive ? simplifiedText : simplifiedText.toLocaleLowerCase())
        .trim()
        .replace(/\s+/gu, " ");
}

function compactSearchValue(value: string) {
    return value.replace(compactSeparatorsPattern, "");
}

export function createSearchMatcher(
    query: string,
    options: ISearchMatchOptions = {},
) {
    const normalizedQuery = normalizeSearchValue(query, options);
    const compactQuery = compactSearchValue(normalizedQuery);
    const tokens = normalizedQuery.split(/\s+/u).filter(Boolean);

    return (values: ReadonlyArray<SearchableValue>) => {
        if (!normalizedQuery) {
            return true;
        }

        const normalizedValues = values
            .map((value) => normalizeSearchValue(value, options))
            .filter(Boolean);
        const searchableText = normalizedValues.join("\n");
        if (searchableText.includes(normalizedQuery)) {
            return true;
        }

        const compactValues = normalizedValues.map(compactSearchValue);
        if (
            compactQuery.length >= 2
            && compactValues.some((value) => value.includes(compactQuery))
        ) {
            return true;
        }

        return tokens.length > 1 && tokens.every((token) => {
            if (searchableText.includes(token)) {
                return true;
            }
            const compactToken = compactSearchValue(token);
            return compactToken.length >= 2
                && compactValues.some((value) => value.includes(compactToken));
        });
    };
}

export function matchesSearchValues(
    values: ReadonlyArray<SearchableValue>,
    query: string,
    options: ISearchMatchOptions = {},
) {
    return createSearchMatcher(query, options)(values);
}

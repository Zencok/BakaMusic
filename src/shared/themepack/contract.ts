export const THEME_SPEC_V2 = "bakamusic-theme@2";

export const REQUIRED_THEME_TOKENS = [
    "--theme-primary",
    "--theme-bg",
    "--theme-text",
    "--theme-scheme",
] as const;

// Accepted only so installed early V2.1 packs keep loading. MusicDetail and
// its immersive MusicBar chrome are product-owned and never consume them.
export const CLIENT_OWNED_COMPATIBILITY_TOKENS = [
    "--theme-detail-bg",
    "--theme-detail-overlay",
    "--theme-detail-text",
    "--theme-detail-text-secondary",
    "--theme-detail-surface",
    "--theme-detail-surface-hover",
    "--theme-detail-border",
    "--theme-detail-accent",
] as const;

/**
 * Public visual contract. Layout, visibility, z-index and product behaviour are
 * deliberately absent: packs may paint every BakaMusic region, but may not
 * restructure it.
 */
export const THEME_TOKENS = [
    ...REQUIRED_THEME_TOKENS,
    "--theme-primary-hover",
    "--theme-primary-active",
    "--theme-text-secondary",
    "--theme-text-muted",
    "--theme-text-on-primary",
    "--theme-header-text",
    "--theme-link",
    "--theme-success",
    "--theme-warning",
    "--theme-danger",
    "--theme-info",
    "--theme-divider",
    "--theme-mask",
    "--theme-placeholder",
    "--theme-surface-alpha",
    "--theme-surface",
    "--theme-surface-strong",
    "--theme-surface-muted",
    "--theme-surface-border",
    "--theme-surface-border-strong",
    "--theme-shadow",
    "--theme-shadow-soft",
    "--theme-interactive",
    "--theme-interactive-hover",
    "--theme-interactive-active",
    "--theme-page-bg",
    "--theme-card-bg",
    "--theme-card-bg-hover",
    "--theme-card-border",
    "--theme-header-bg",
    "--theme-header-border",
    "--theme-header-control-bg",
    "--theme-header-control-hover-bg",
    "--theme-header-search-bg",
    "--theme-header-search-border",
    "--theme-sidebar-bg",
    "--theme-sidebar-text",
    "--theme-sidebar-text-secondary",
    "--theme-sidebar-text-muted",
    "--theme-sidebar-border",
    "--theme-sidebar-item-hover",
    "--theme-sidebar-item-active",
    "--theme-sidebar-item-active-border",
    "--theme-player-bg",
    "--theme-player-bg-alt",
    "--theme-player-text",
    "--theme-player-text-secondary",
    "--theme-player-accent",
    "--theme-player-text-on-accent",
    "--theme-player-border",
    "--theme-list-bg",
    "--theme-list-row-bg",
    "--theme-list-row-alt-bg",
    "--theme-list-row-hover-bg",
    "--theme-list-row-active-bg",
    "--theme-list-row-border",
    "--theme-panel-bg",
    "--theme-panel-text",
    "--theme-panel-text-secondary",
    "--theme-panel-border",
    "--theme-panel-row-bg",
    "--theme-panel-row-hover-bg",
    "--theme-panel-row-border",
    "--theme-input-bg",
    "--theme-input-bg-hover",
    "--theme-input-border",
    "--theme-input-border-active",
    "--theme-popover-bg",
    "--theme-popover-text",
    "--theme-popover-text-secondary",
    "--theme-popover-border",
    ...CLIENT_OWNED_COMPATIBILITY_TOKENS,
    "--theme-blur",
    "--theme-bg-image",
    "--theme-scrollbar-track",
    "--theme-scrollbar-thumb",
    "--theme-scrollbar-thumb-hover",
    "--theme-scrollbar-thumb-active",
    "--theme-radius-control",
    "--theme-radius-card",
    "--theme-radius-panel",
    "--theme-radius-cover",
] as const;

const THEME_TOKEN_SET = new Set<string>(THEME_TOKENS);
const REQUIRED_THEME_TOKEN_SET = new Set<string>(REQUIRED_THEME_TOKENS);
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const ROOT_BLOCK_PATTERN = /^\s*:root\s*\{([\s\S]*)\}\s*$/;
const UNSAFE_VALUE_PATTERN = /[{}]|@import|expression\s*\(|javascript\s*:/i;
const VARIABLE_REFERENCE_PATTERN = /var\(\s*(--[a-zA-Z0-9-]+)/g;

export interface IParsedThemeCss {
    css: string;
    tokens: ReadonlyMap<string, string>;
}

function splitDeclarations(rawDeclarations: string): string[] {
    const declarations: string[] = [];
    let current = "";
    let quote: "\"" | "'" | null = null;
    let parenthesesDepth = 0;

    for (let index = 0; index < rawDeclarations.length; index += 1) {
        const character = rawDeclarations[index];
        const previous = rawDeclarations[index - 1];

        if ((character === "\"" || character === "'") && previous !== "\\") {
            quote = quote === character ? null : quote ?? character;
        } else if (!quote && character === "(") {
            parenthesesDepth += 1;
        } else if (!quote && character === ")") {
            parenthesesDepth -= 1;
            if (parenthesesDepth < 0) {
                throw new Error("Theme CSS contains an unmatched parenthesis");
            }
        }

        if (!quote && parenthesesDepth === 0 && character === ";") {
            if (current.trim()) {
                declarations.push(current.trim());
            }
            current = "";
        } else {
            current += character;
        }
    }

    if (quote || parenthesesDepth !== 0) {
        throw new Error("Theme CSS contains an unterminated value");
    }
    if (current.trim()) {
        declarations.push(current.trim());
    }
    return declarations;
}

function validateTokenValue(token: string, value: string) {
    if (!value || value.includes("!important") || UNSAFE_VALUE_PATTERN.test(value)) {
        throw new Error(`Invalid value for ${token}`);
    }
    if (token === "--theme-scheme" && value !== "light" && value !== "dark") {
        throw new Error("--theme-scheme must be light or dark");
    }
    if (token === "--theme-surface-alpha") {
        const alpha = Number(value);
        if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
            throw new Error("--theme-surface-alpha must be between 0 and 1");
        }
    }

    for (const match of value.matchAll(VARIABLE_REFERENCE_PATTERN)) {
        if (!THEME_TOKEN_SET.has(match[1])) {
            throw new Error(`${token} references private token ${match[1]}`);
        }
    }
}

/** Parse and canonicalise the only CSS shape accepted by theme@2. */
export function parseThemeCss(rawCss: string): IParsedThemeCss {
    const withoutComments = rawCss.replace(COMMENT_PATTERN, "");
    const rootMatch = withoutComments.match(ROOT_BLOCK_PATTERN);
    if (!rootMatch) {
        throw new Error("Theme CSS must contain exactly one :root block");
    }

    const tokens = new Map<string, string>();
    for (const declaration of splitDeclarations(rootMatch[1])) {
        const colonIndex = declaration.indexOf(":");
        if (colonIndex < 1) {
            throw new Error(`Invalid theme declaration: ${declaration}`);
        }
        const token = declaration.slice(0, colonIndex).trim();
        const value = declaration.slice(colonIndex + 1).trim();
        if (!THEME_TOKEN_SET.has(token)) {
            throw new Error(`Unknown theme token: ${token}`);
        }
        if (tokens.has(token)) {
            throw new Error(`Duplicate theme token: ${token}`);
        }
        validateTokenValue(token, value);
        tokens.set(token, value);
    }

    for (const requiredToken of REQUIRED_THEME_TOKEN_SET) {
        if (!tokens.has(requiredToken)) {
            throw new Error(`Missing required theme token: ${requiredToken}`);
        }
    }

    const declarations = Array.from(tokens, ([token, value]) => `    ${token}: ${value};`);
    return {
        css: `html[data-theme-spec="2"] {\n${declarations.join("\n")}\n}`,
        tokens,
    };
}

/**
 * Validate both author configs and published configs. The publisher is allowed
 * to append identity metadata (`id`, `createdAt`) that is preserved locally.
 */
export function validateThemePackConfig(jsonData: Record<string, unknown>) {
    const allowedFields = new Set([
        "spec",
        "name",
        "author",
        "authorUrl",
        "version",
        "preview",
        "description",
        "tags",
        "scheme",
        "iframe",
        "id",
        "createdAt",
    ]);
    const requiredStringFields = [
        "name",
        "author",
        "version",
        "preview",
        "description",
        "scheme",
    ] as const;

    if (jsonData.spec !== THEME_SPEC_V2) {
        throw new Error(`config.spec must be ${THEME_SPEC_V2}`);
    }
    for (const field of requiredStringFields) {
        if (typeof jsonData[field] !== "string" || !jsonData[field].trim()) {
            throw new Error(`config.${field} is required`);
        }
    }
    if (!/^\d+\.\d+\.\d+$/.test(jsonData.version as string)) {
        throw new Error("config.version must be semver x.y.z");
    }
    if (jsonData.scheme !== "light" && jsonData.scheme !== "dark") {
        throw new Error("config.scheme must be light or dark");
    }
    if (
        !Array.isArray(jsonData.tags)
        || jsonData.tags.length < 1
        || jsonData.tags.length > 5
        || jsonData.tags.some((tag) => typeof tag !== "string" || !tag.trim())
    ) {
        throw new Error("config.tags must contain 1-5 strings");
    }
    for (const field of Object.keys(jsonData)) {
        if (!allowedFields.has(field)) {
            throw new Error(`Unknown theme config field: ${field}`);
        }
    }
    if (
        jsonData.authorUrl !== undefined
        && (typeof jsonData.authorUrl !== "string" || !/^https?:\/\//.test(jsonData.authorUrl))
    ) {
        throw new Error("config.authorUrl must be an http(s) URL");
    }
    if (jsonData.id !== undefined && (typeof jsonData.id !== "string" || !jsonData.id.trim())) {
        throw new Error("config.id must be a non-empty string");
    }
    if (
        jsonData.createdAt !== undefined
        && (typeof jsonData.createdAt !== "string" || Number.isNaN(Date.parse(jsonData.createdAt)))
    ) {
        throw new Error("config.createdAt must be an ISO date string");
    }

    const preview = jsonData.preview as string;
    if (!preview.startsWith("@/") && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(preview)) {
        throw new Error("config.preview must be a pack path or hex colour");
    }
    if (jsonData.iframe !== undefined) {
        if (!jsonData.iframe || typeof jsonData.iframe !== "object" || Array.isArray(jsonData.iframe)) {
            throw new Error("config.iframe must be an object");
        }
        const iframe = jsonData.iframe as Record<string, unknown>;
        if (
            Object.keys(iframe).length !== 1
            || typeof iframe.app !== "string"
            || !iframe.app.startsWith("@/")
        ) {
            throw new Error("config.iframe only accepts local app slot");
        }
        if (!(jsonData.tags as string[]).includes("动态")) {
            throw new Error("iframe themes must include 动态 tag");
        }
    }
}

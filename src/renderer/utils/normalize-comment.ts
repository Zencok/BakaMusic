/** Adapt a provider comment into the shared comment presentation model. */
export default function normalizeComment(value: unknown, depth = 0): IComment.IComment {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const user = item.user && typeof item.user === "object" ? item.user as Record<string, unknown> : {};
    const text = (value: unknown) => typeof value === "string" ? value : "";
    const timestamp = item.timestamp ?? item.createAt;
    return {
        id: typeof item.id === "string" || typeof item.id === "number" ? item.id : undefined,
        nickName: text(item.username ?? user.name ?? item.nickName),
        comment: text(item.content ?? item.comment),
        avatar: text(item.avatar ?? user.avatar) || undefined,
        createAt: typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : undefined,
        like: typeof item.like === "number" ? item.like : undefined,
        location: text(item.location) || undefined,
        replies: depth < 5 && Array.isArray(item.replies) ? item.replies.map((reply) => normalizeComment(reply, depth + 1)) : [],
    };
}

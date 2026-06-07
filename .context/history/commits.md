# Commit Decision History

> 此文件是 `commits.jsonl` 的人类可读视图，可由工具重生成。
> Canonical store: `commits.jsonl` (JSONL, append-only)

| Date | Context-Id | Commit | Summary | Decisions | Bugs | Risk |
|------|-----------|--------|---------|-----------|------|------|
| 2026-06-07T01:14:12.0424662+08:00 | 1015ba83-fc0d-4cf7-8789-386e2aabbc40 | pending | feat(lyric): keep unplayed desktop lyrics white | Mark AMLL line play state in wrapper | - | Depends on AMLL currentLyricLineObjects internals |
| 2026-06-07T14:43:26.3746113+08:00 | 3eaa18d6-88ac-4dab-b67c-e325a9f79b8a | pending | refactor(amll): integrate lyric core into source tree | Move AMLL runtime source into src/amll-core; Exclude imported AMLL core from project lint and typecheck initially | ESLint warnings after migration cleanup | Deferred AMLL core normalization |
| 2026-06-07T15:02:48.8291546+08:00 | e0d8da6c-de67-452f-9b4f-213a4566ca8f | pending | fix(plugin): repair subscription update flow | Show a loading modal for subscription updates; Read latest saved subscriptions before updating | Subscription update had no visible progress; Automatic plugin update IPC did not reach main reliably | Reuses a generic loading modal for no-input async flows |

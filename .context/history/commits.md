# Commit Decision History

> 此文件是 `commits.jsonl` 的人类可读视图，可由工具重生成。
> Canonical store: `commits.jsonl` (JSONL, append-only)

| Date | Context-Id | Commit | Summary | Decisions | Bugs | Risk |
|------|-----------|--------|---------|-----------|------|------|
| 2026-06-07T01:14:12.0424662+08:00 | 1015ba83-fc0d-4cf7-8789-386e2aabbc40 | pending | feat(lyric): keep unplayed desktop lyrics white | Mark AMLL line play state in wrapper | - | Depends on AMLL currentLyricLineObjects internals |
| 2026-06-07T14:43:26.3746113+08:00 | 3eaa18d6-88ac-4dab-b67c-e325a9f79b8a | pending | refactor(amll): integrate lyric core into source tree | Move AMLL runtime source into src/amll-core; Exclude imported AMLL core from project lint and typecheck initially | ESLint warnings after migration cleanup | Deferred AMLL core normalization |
| 2026-06-07T15:02:48.8291546+08:00 | e0d8da6c-de67-452f-9b4f-213a4566ca8f | pending | fix(plugin): repair subscription update flow | Show a loading modal for subscription updates; Read latest saved subscriptions before updating | Subscription update had no visible progress; Automatic plugin update IPC did not reach main reliably | Reuses a generic loading modal for no-input async flows |
| 2026-06-07T15:14:44.1761652+08:00 | 7cc705a3-9f1e-40f0-8eec-d0eaf6054ca2 | pending | fix(ui): expand remaining music action hit areas | Apply full-container hit areas to remaining circular music actions; Keep the MusicBar comment action on the shell | Some circular favorite/download actions only responded when clicking the icon center | Keeps visual icon sizes unchanged while expanding click targets |
| 2026-06-07T15:42:27.5439366+08:00 | a740b5e2-480f-4e13-8bec-05975a46ac34 | pending | fix(about): simplify attribution and add QQ group | Simplify About page attribution links | - | Low |
| 2026-06-07T15:57:30.1559431+08:00 | 0b71c249-a07f-4e57-80ad-3d1690967cf6 | pending | fix(settings): prevent listbox overlay clipping | Portal settings listbox panels | Settings dropdowns could be covered by later setting sections | Low |
| 2026-06-07T16:03:10.9917496+08:00 | de408a25-8057-4b72-aba4-ec73cec2387e | pending | feat(about): add telegram group link | Expose Telegram group in About page | - | Low |
| 2026-06-07T16:10:37.1098172+08:00 | 8db735a9-4340-457e-9819-e2f3f1ac0e97 | pending | style(header): simplify app logo mark | Replace decorative header logo with a simpler mark | - | Low |
| 2026-06-07T16:40:11.7103147+08:00 | 9c360bae-fd0c-4c4f-904f-2e7654a0eacc | pending | feat(search): refresh current platform results | Add an explicit forced search path; Expose refresh as a scoped search result action | Repeating the same search on the same platform could not refetch results | Low |

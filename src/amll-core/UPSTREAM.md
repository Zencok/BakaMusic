# AMLL Core upstream baseline

- Repository: https://github.com/amll-dev/applemusic-like-lyrics
- Package: `@applemusic-like-lyrics/core`
- Version: `0.5.2`
- Tag: `core-bundle@0.5.2`
- Release commit: `fd7ec2d597daa2a66a37ca5f3214d6757ec17cfa`

The source under this directory is based on `packages/core/src` from the
upstream release above. Keep it vendored because BakaMusic carries a small set
of player-level behavior and appearance changes that are not exposed by the
published package API.

## BakaMusic patches

1. Configurable inactive lyric brightness.
2. Optional horizontally centered interlude dots.
3. Interlude-dot layout updates while playback is paused.
4. Larger translation/romanization lines with active-line emphasis.
5. Normal line height for lyric word wrappers to avoid clipped descenders.
6. Restrained lyric blur falloff that keeps nearby inactive lines clear.
7. Word-level and line-level romanization displayed above the source lyric.

When updating the baseline, replace the upstream source first and then reapply
the patches above. Verify both the main lyric view and the desktop lyric window.

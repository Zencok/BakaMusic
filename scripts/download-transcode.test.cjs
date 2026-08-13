const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
    DOWNLOAD_MP3_BITRATES,
    classifyAudioCodec,
    isDownloadMp3Bitrate,
    isDownloadTranscodeMode,
    isTranscodableContainer,
    normalizeAudioCodecName,
    resolveTranscodeTarget,
} = require("../src/common/audio-transcode.ts");

function target(filePath, codecName, mode = "auto", mp3Bitrate = "v0") {
    return resolveTranscodeTarget({ filePath, codecName, mode, mp3Bitrate });
}

// --- container gate -------------------------------------------------------
for (const name of ["a.m4a", "A.M4A", "b.mp4", "c.m4b", "d.m4r"]) {
    assert.equal(isTranscodableContainer(name), true, `${name} should be a candidate`);
}
for (const name of ["a.mp3", "a.flac", "a.ogg", "a.wav", "a.ape", "noext", ".m4a", ""]) {
    assert.equal(isTranscodableContainer(name), false, `${name} must be left alone`);
}

// --- codec classification -------------------------------------------------
assert.equal(classifyAudioCodec("aac"), "lossy");
assert.equal(classifyAudioCodec("AAC"), "lossy");
assert.equal(classifyAudioCodec("  aac  "), "lossy");
assert.equal(classifyAudioCodec("opus"), "lossy");
assert.equal(classifyAudioCodec("flac"), "lossless");
assert.equal(classifyAudioCodec("alac"), "lossless");
assert.equal(classifyAudioCodec("pcm_s16le"), "lossless");
// Dolby / surround must never be downmixed.
for (const codec of ["ac4", "ac3", "eac3", "truehd", "dts", "dtshd"]) {
    assert.equal(classifyAudioCodec(codec), "preserve", `${codec} must be preserved`);
}
// Unknown codec is treated as untouchable rather than guessed at.
assert.equal(classifyAudioCodec(null), "preserve");
assert.equal(classifyAudioCodec(undefined), "preserve");
assert.equal(classifyAudioCodec(""), "preserve");
assert.equal(normalizeAudioCodecName(" FLAC "), "flac");

// --- target resolution ----------------------------------------------------
const aacTarget = target("song.m4a", "aac");
assert.equal(aacTarget.format, "mp3");
assert.equal(aacTarget.extension, ".mp3");
assert.equal(aacTarget.encoder, "libmp3lame");
assert.equal(aacTarget.lossless, false);

const flacTarget = target("song.m4a", "flac");
assert.equal(flacTarget.format, "flac");
assert.equal(flacTarget.extension, ".flac");
assert.equal(flacTarget.encoder, "flac");
assert.equal(flacTarget.encoderOptions, "");
assert.equal(flacTarget.lossless, true);

assert.equal(target("song.m4a", "alac").format, "flac");

// QQ 音乐 dolby ships AC-4 inside MP4 and must stay as downloaded.
assert.equal(target("dolby.mp4", "ac4"), null);
assert.equal(target("surround.m4a", "eac3"), null);

// Native containers are never re-encoded, whatever is inside them.
assert.equal(target("song.mp3", "mp3"), null);
assert.equal(target("song.flac", "flac"), null);

// Mode gate.
assert.equal(target("song.m4a", "aac", "off"), null);

// --- bitrate mapping ------------------------------------------------------
assert.equal(target("s.m4a", "aac", "auto", "192k").encoderOptions, "b=192k");
assert.equal(target("s.m4a", "aac", "auto", "256k").encoderOptions, "b=256k");
assert.equal(target("s.m4a", "aac", "auto", "320k").encoderOptions, "b=320k");
assert.equal(target("s.m4a", "aac", "auto", "v0").encoderOptions, "q=0");

// --- guards ---------------------------------------------------------------
assert.equal(isDownloadTranscodeMode("off"), true);
assert.equal(isDownloadTranscodeMode("auto"), true);
assert.equal(isDownloadTranscodeMode("mp3"), false);
assert.equal(isDownloadTranscodeMode(null), false);
for (const bitrate of DOWNLOAD_MP3_BITRATES) {
    assert.equal(isDownloadMp3Bitrate(bitrate), true);
}
assert.equal(isDownloadMp3Bitrate("128k"), false);
assert.equal(isDownloadMp3Bitrate(320), false);

// --- wiring ---------------------------------------------------------------
const read = (relative) =>
    fs.readFileSync(path.resolve(__dirname, "..", relative), "utf8");

const defaultConfig = read("src/shared/app-config/default-app-config.ts");
assert.match(defaultConfig, /"download\.transcodeMode": "off"/);
assert.match(defaultConfig, /"download\.transcodeMp3Bitrate": "v0"/);

const appConfigMain = read("src/shared/app-config/main.ts");
assert.match(appConfigMain, /"download\.transcodeMode"/);
assert.match(appConfigMain, /"download\.transcodeMp3Bitrate"/);
assert.match(appConfigMain, /\["download\.transcodeMode", new Set\(\["off", "auto"\]\)\]/);

// The utility resolves libmpv from this variable; without it transcoding
// silently degrades to "always failed".
const nodeRuntimeMain = read("src/shared/node-runtime/main.ts");
assert.match(nodeRuntimeMain, /BAKAMUSIC_MPV_DIR: mpvRuntimeDirectory/);
assert.match(nodeRuntimeMain, /@shared\/node-runtime\/transcode-download/);

const host = read("src/shared/node-runtime/utility/node-runtime-host.ts");
assert.match(host, /case "transcode-download":/);

const preload = read("src/shared/node-runtime/preload.ts");
assert.match(preload, /transcodeDownloadedFile/);

// Three locales must stay in sync or the settings page renders raw keys.
for (const lang of ["zh-CN", "zh-TW", "en-US"]) {
    const messages = JSON.parse(read(`res/lang/${lang}.json`));
    const download = messages.settings.download;
    for (const key of [
        "transcode_mode",
        "transcode_mode_off",
        "transcode_mode_auto",
        "transcode_rules",
        "transcode_rules_tip",
        "transcode_mp3_bitrate",
        "transcode_mp3_bitrate_v0",
    ]) {
        assert.ok(download[key], `${lang} is missing settings.download.${key}`);
    }
    assert.ok(messages.settings.group.download_transcode, `${lang} group title`);
    assert.ok(messages.settings.group.download_transcode_desc, `${lang} group desc`);
    assert.ok(messages.download_page.transcoding, `${lang} progress label`);
}

console.log("download transcode policy tests passed");

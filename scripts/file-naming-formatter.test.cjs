const assert = require("node:assert/strict");

const {
    buildDownloadFileBaseName,
    formatFilename,
    generateFileNameFromConfig,
    previewFilename,
    validateTemplate,
    getPresetTemplate,
} = require("../src/common/file-naming-formatter.ts");

const music = {
    id: "1",
    platform: "test",
    title: "烟火里的尘埃",
    artist: "郁欢",
    album: "烟火里的尘埃",
};

// Default preset keeps historical title-artist order
assert.equal(
    buildDownloadFileBaseName(music, { type: "preset", preset: "title-artist" }),
    "烟火里的尘埃-郁欢",
);

// Artist first (user example: author - title)
assert.equal(
    buildDownloadFileBaseName(music, {
        type: "custom",
        custom: "{artist} - {title}",
    }),
    "郁欢 - 烟火里的尘埃",
);

assert.equal(
    buildDownloadFileBaseName(music, {
        type: "preset",
        preset: "artist-title",
    }),
    "郁欢-烟火里的尘埃",
);

// Quality in template
assert.equal(
    buildDownloadFileBaseName(
        music,
        {
            type: "custom",
            custom: "{title}-{artist}-{quality}",
        },
        "320k",
    ),
    "烟火里的尘埃-郁欢-320k",
);

// Illegal path characters are sanitized
assert.equal(
    buildDownloadFileBaseName(
        {
            ...music,
            title: "a/b:c",
            artist: "x*y",
        },
        { type: "custom", custom: "{title}-{artist}" },
    ),
    "a_b_c-x_y",
);

// Validation
assert.equal(validateTemplate("{title}-{artist}").valid, true);
assert.equal(validateTemplate("").valid, false);
assert.equal(validateTemplate("hello").valid, false);
assert.equal(validateTemplate("{title}/bad").valid, false);

// Empty album does not leave dangling separators
assert.equal(
    formatFilename({
        template: "{title}-{album}-{artist}",
        variables: {
            title: "Song",
            artist: "Artist",
            album: "",
            platform: "p",
            id: "1",
        },
    }).filename,
    "Song-Artist",
);

assert.equal(getPresetTemplate("artist-album-title"), "{artist}-{album}-{title}");
assert.ok(previewFilename("{artist} - {title}").includes(" - "));

assert.equal(
    generateFileNameFromConfig(music, {
        type: "preset",
        preset: "title",
        maxLength: 200,
        keepExtension: true,
    }).filename,
    "烟火里的尘埃",
);

console.log("file-naming-formatter: all assertions passed");

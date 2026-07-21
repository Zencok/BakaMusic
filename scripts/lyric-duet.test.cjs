const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const LyricParser = require("../src/renderer/utils/lyric-parser").default;

function createMusicItem(artist) {
    return {
        artist,
        id: "duet-test",
        platform: "test",
        title: "duet-test",
    };
}

{
    const parser = new LyricParser([
        "[00:01.000]主唱句（另一人）",
        "[00:04.000](先入场)第二句",
        "[00:07.000]收尾",
    ].join("\n"), {
        musicItem: createMusicItem("主唱, 另一人"),
    });
    const lines = parser.getLyricItems();

    assert.deepEqual(
        lines.map((line) => [line.lrc, line.isBG, line.isDuet]),
        [
            ["主唱句", false, false],
            ["另一人", false, true],
            ["第二句", false, false],
            ["先入场", false, true],
            ["收尾", false, false],
        ],
    );
    assert.equal(lines[0].endTime, lines[1].endTime);
    assert.equal(lines[1].isDuetPartner, true);
    assert.equal(parser.getPosition(2)?.lrc, "主唱句");
    assert.match(parser.toString(), /（另一人）/);
}

{
    const parser = new LyricParser([
        "[00:01.000]<00:01.000>主<00:01.200>句<00:01.400>（<00:01.500>other<00:02.500>）<00:02.600>",
        "[00:03.000]<00:03.000>（<00:03.100>response<00:04.000>）<00:04.100>",
        "[00:05.000]<00:05.000>收<00:05.300>尾<00:06.000>",
    ].join("\n"), {
        musicItem: createMusicItem("主唱, 另一人"),
    });
    const lines = parser.getLyricItems();

    assert.deepEqual(
        lines.map((line) => [line.lrc, line.isDuet]),
        [
            ["主句", false],
            ["other", true],
            ["response", true],
            ["收尾", false],
        ],
    );
    assert.equal(lines[0].words.map((word) => word.text).join(""), "主句");
    assert.equal(lines[1].words.map((word) => word.text).join(""), "other");
    assert.equal(lines[2].words.map((word) => word.text).join(""), "response");
    assert.equal(lines[1].hasWordTimeline, true);
    assert.equal(lines[2].hasWordTimeline, true);
}

{
    const parser = new LyricParser([
        "[00:01.000]<00:01.000>乙<00:01.100>：<00:01.200>今<00:01.400>（<00:01.500>い<00:01.600>ま<00:01.700>）<00:02.000>",
        "[00:01.000]乙：现在",
        "[00:02.000]<00:02.000>甲<00:02.100>：<00:02.200>你好<00:03.000>",
        "[00:02.000]甲：Hello",
        "[00:03.000]<00:03.000>合<00:03.100>唱<00:03.200>：<00:03.300>一起<00:04.000>",
        "[00:03.000]合唱：Together",
    ].join("\n"), {
        musicItem: createMusicItem("甲, 乙"),
    });
    const lines = parser.getLyricItems();

    assert.equal(lines.length, 3);
    assert.deepEqual(
        lines.map((line) => [line.lrc, line.translation, line.isDuet]),
        [
            ["乙：今（いま）", "现在", true],
            ["甲：你好", "Hello", false],
            ["合唱：一起", "Together", false],
        ],
    );
    assert.equal(lines.some((line) => line.isBG), false);
    assert.equal(lines[0].words.map((word) => word.text).join(""), "乙：今（いま）");
}

{
    const parser = new LyricParser([
        "[00:00.000]<00:00.000>词<00:00.100>：<00:00.200>Tester<00:01.000>",
        "[00:01.000]<00:01.000>银<00:01.100>：<00:01.200>",
        "[00:01.200]<00:01.200>第一段<00:02.000>",
        "[00:02.000]<00:02.000>Aki<00:02.100>：<00:02.200>",
        "[00:02.200]<00:02.200>第二段<00:03.000>",
    ].join("\n"), {
        musicItem: createMusicItem("银临, Aki阿杰"),
    });
    const lines = parser.getLyricItems();

    assert.deepEqual(
        lines.map((line) => [line.lrc, line.isDuet]),
        [
            ["词：Tester", false],
            ["银：第一段", false],
            ["Aki：第二段", true],
        ],
    );
}

{
    const parser = new LyricParser([
        "咩栗：今（いま）のってどう思（おも）う？",
        "刚才这段旋律怎么样？",
        "咩栗：恋（こい）の味（あじ）もする",
        "而且还有恋爱的味道",
        "呜米：（叩く音）こっちおいで",
        "（拍地的声音）来，过来这边",
        "呜米：内緒（ないしょ）",
        "秘密",
    ].join("\n"), {
        musicItem: createMusicItem("咩栗, 呜米"),
    });
    const lines = parser.getLyricItems();

    assert.deepEqual(
        lines.map((line) => [line.lrc, line.isDuet]),
        [
            ["咩栗：今（いま）のってどう思（おも）う？", false],
            ["刚才这段旋律怎么样？", false],
            ["恋（こい）の味（あじ）もする", false],
            ["而且还有恋爱的味道", false],
            ["呜米：（叩く音）こっちおいで", true],
            ["（拍地的声音）来，过来这边", true],
            ["内緒（ないしょ）", true],
            ["秘密", true],
        ],
    );
}

{
    const parser = new LyricParser([
        "[00:01.000]甲：第一句",
        "[00:02.000]甲：第二句",
        "[00:03.000]乙：第三句",
        "[00:04.000]乙：第四句",
        "[00:05.000]甲：第五句",
    ].join("\n"), {
        musicItem: createMusicItem("甲, 乙"),
    });

    assert.deepEqual(
        parser.getLyricItems().map((line) => [line.lrc, line.isDuet]),
        [
            ["甲：第一句", false],
            ["第二句", false],
            ["乙：第三句", true],
            ["第四句", true],
            ["甲：第五句", false],
        ],
    );
}

{
    const parser = new LyricParser([
        "[00:01.000]v1:Left",
        "[00:02.000]v2:Right",
    ].join("\n"));

    assert.deepEqual(
        parser.getLyricItems().map((line) => [line.lrc, line.isDuet]),
        [
            ["Left", false],
            ["Right", true],
        ],
    );
}

{
    const parser = new LyricParser([
        "[00:01.000]华晨宇：我看着爱笑",
        "[00:02.000]却还有些失落",
        "[00:03.000]火星人：那些失落也在我心里",
        "[00:04.000]我看着自信",
        "[00:05.000]却还有些退缩",
        "[00:06.000]火星人：那些退缩请你别在意",
        "[00:07.000]我看着努力",
    ].join("\n"), {
        musicItem: createMusicItem("华晨宇"),
    });

    assert.deepEqual(
        parser.getLyricItems().map((line) => [line.lrc, line.isDuet]),
        [
            ["华晨宇：我看着爱笑", false],
            ["却还有些失落", false],
            ["火星人：那些失落也在我心里", true],
            ["我看着自信", false],
            ["却还有些退缩", false],
            ["火星人：那些退缩请你别在意", true],
            ["我看着努力", false],
        ],
    );
}

{
    const parser = new LyricParser([
        "[00:00.000]<00:00.000>编<00:00.100>曲<00:00.200>：<00:00.300>Alice<00:00.500>",
        "[00:01.000]<00:01.000>开<00:01.300>场<00:04.000>",
        "[00:02.000]<00:02.000>第<00:02.300>一？<00:03.000>",
        "[00:04.000]<00:04.000>第<00:04.300>二<00:06.000>",
        "[00:06.000]<00:06.000>续<00:06.300>句<00:07.000>",
        "[00:08.000]<00:08.000>第<00:08.300>三？<00:09.000>",
    ].join("\n"), {
        musicItem: createMusicItem("歌手甲, 歌手乙"),
    });

    assert.deepEqual(
        parser.getLyricItems().map((line) => [line.lrc, line.isDuet]),
        [
            ["编曲：Alice", false],
            ["开场", false],
            ["第一？", false],
            ["第二", true],
            ["续句", true],
            ["第三？", false],
        ],
    );
}

{
    const parser = new LyricParser([
        "[00:01.000]统筹：Alice",
        "[00:02.000]导演：Bob",
        "[00:03.000]正式歌词",
    ].join("\n"), {
        musicItem: createMusicItem("歌手甲, 歌手乙"),
    });

    assert.deepEqual(
        parser.getLyricItems().map((line) => [line.lrc, line.isDuet]),
        [
            ["统筹：Alice", false],
            ["导演：Bob", false],
            ["正式歌词", false],
        ],
    );
}

{
    const parser = new LyricParser("[00:01.000]独唱歌词（低语）", {
        musicItem: createMusicItem("独唱歌手"),
    });

    assert.deepEqual(
        parser.getLyricItems().map((line) => [line.lrc, line.isDuet]),
        [["独唱歌词（低语）", false]],
    );
}

{
    const parser = new LyricParser([
        "[00:01.000]甲：主句（和声）",
        "[00:04.000]乙：次句",
    ].join("\n"), {
        musicItem: createMusicItem("甲, 乙"),
        translation: [
            "[00:01.000]甲：Main translation",
            "[00:04.000]乙：Second translation",
        ].join("\n"),
    });
    const lines = parser.getLyricItems();

    assert.deepEqual(
        lines.map((line) => [line.lrc, line.translation, line.isBG, line.isDuet]),
        [
            ["甲：主句", "Main translation", false, false],
            ["和声", undefined, false, true],
            ["乙：次句", "Second translation", false, true],
        ],
    );
}

{
    const parser = new LyricParser([
        "[00:00.150]Written by：Jacob Kasher/Charlie Puth/Hindlin/Selena Gomez",
        "[00:00.860]Charlie Puth：",
        "[00:00.860]<00:00.860>We <00:01.200>don't <00:01.600>talk <00:02.000>anymore <00:03.000>we <00:03.400>don't <00:03.800>talk <00:04.200>anymore<00:05.200>",
        "[00:00.860]只剩沉默 我们之间只剩沉默",
        "[00:05.523]We don't talk anymore like we used to do",
        "[00:05.523]只剩沉默 耳语亲昵已是从前",
    ].join("\n"), {
        musicItem: {
            artist: "Charlie Puth, Selena Gomez",
            id: "105539541",
            platform: "QQ音乐",
            title: "We Don't Talk Anymore",
        },
    });
    const lines = parser.getLyricItems();

    assert.deepEqual(
        lines.map((line) => [line.time, line.lrc, line.translation]),
        [
            [0.15, "Written by：Jacob Kasher/Charlie Puth/Hindlin/Selena Gomez", undefined],
            [0.86, "Charlie Puth：We don't talk anymore we don't talk anymore", "只剩沉默 我们之间只剩沉默"],
            [5.523, "We don't talk anymore like we used to do", "只剩沉默 耳语亲昵已是从前"],
        ],
    );
    assert.equal(
        lines[1].words.map((word) => word.text).join(""),
        "Charlie Puth：We don't talk anymore we don't talk anymore",
    );
}

{
    const parser = new LyricParser([
        "[00:00.150]<00:00.150>Written by：Jacob Kasher/Charlie Puth/Hindlin/Selena Gomez<00:00.300>",
        "[00:00.150]只剩沉默 我们之间只剩沉默",
        "[00:00.860]",
        "[00:00.860]We don't talk anymore we don't talk anymore",
        "[00:05.523]<00:05.523>We <00:05.666>don't <00:05.962>talk <00:06.281>anymore<00:07.080>",
    ].join("\n"), {
        musicItem: {
            artist: "Charlie Puth, Selena Gomez",
            id: "105539541",
            platform: "QQ音乐",
            title: "We Don't Talk Anymore",
        },
    });
    const lines = parser.getLyricItems();

    assert.equal(lines[0].lrc, "Written by：Jacob Kasher/Charlie Puth/Hindlin/Selena Gomez");
    assert.equal(lines[0].translation, undefined);
    assert.equal(lines[1].time, 0.86);
    assert.equal(lines[1].lrc, "We don't talk anymore we don't talk anymore");
    assert.equal(lines[1].translation, "只剩沉默 我们之间只剩沉默");
    assert.equal(lines.some((line) => line.isDuet), false);
}

{
    const parser = new LyricParser([
        "[00:02.966]词：方文山",
        "[00:03.902]曲：周杰伦",
        "[00:06.126]编曲：刘卓@维伴音乐/金天@维伴音乐",
        "[00:09.350]<00:10.100>刘<00:10.131>卓<00:10.164>@<00:10.164>维<00:10.198>伴<00:10.231>音<00:10.264>乐<00:10.296>",
        "[00:10.296]<00:10.463>张<00:10.495>碧<00:10.528>晨<00:10.561>",
        "[00:10.561]<00:10.694>石<00:10.729>行<00:10.761>@<00:10.761>维<00:10.793>伴<00:10.824>音<00:10.858>乐<00:10.892>",
        "[00:19.028]<00:19.028>看<00:19.332>你<00:19.757>在<00:20.180>摇<00:20.677>椅<00:21.412>上<00:21.989>织<00:22.821>围<00:23.437>巾<00:24.396>",
    ].join("\n"), {
        musicItem: createMusicItem("张碧晨, 张钰琪"),
    });
    const lines = parser.getLyricItems();

    assert.equal(lines.find((line) => line.lrc === "张碧晨")?.isDuet, false);
    assert.equal(lines.some((line) => line.isDuet), false);
}

{
    const parser = new LyricParser([
        "[00:00.330]带我到山顶 - 吴莫愁",
        "[00:00.330]《熊出没·年年有熊》电影片尾曲",
        "[00:07.360]词：奥杰阿格",
        "[00:09.220]曲：吉克曲布",
        "[00:10.980]郭思达/李智平",
        "[00:13.890]编曲：张中豪",
        "[00:15.720]大凉山妞妞合唱团",
        "[00:19.810]曾婕Joey.Z",
        "[00:22.550]录音：王近祯",
        "[00:24.240]Gstar音乐工作室",
        "[01:01.860]唔吔哎 带我到山顶",
    ].join("\n"), {
        musicItem: createMusicItem("吴莫愁"),
    });

    const lines = parser.getLyricItems();
    assert.equal(lines.some((line) => line.isDuet), false);
    assert.equal(lines[0].lrc, "带我到山顶 - 吴莫愁");
    assert.equal(lines[0].translation, "《熊出没·年年有熊》电影片尾曲");
    assert.equal(lines.some((line) => line.lrc === "编曲：张中豪"), true);
    assert.equal(lines.some((line) => line.lrc === "大凉山妞妞合唱团"), true);
}

{
    const parser = new LyricParser([
        "[00:01.300]作词：石见",
        "[00:01.670]作曲：莎娃子",
        "[00:01.920]编曲：EZM",
        "[00:02.210]和声：Ciyo",
        "[00:02.500]混音：兰音Reine",
        "[00:02.780]母带：兰音Reine",
        "[00:03.060]张亮/企鹅",
        "[00:03.310]监制：Yang",
        "[00:03.590]张亮",
        "[00:03.950]虚研制作/兰音工作室",
        "[00:16.230]柳上蝉无话 东风无力吹起沙",
    ].join("\n"), {
        musicItem: createMusicItem("兰音Reine"),
    });
    const lines = parser.getLyricItems();

    assert.equal(lines.some((line) => line.isDuet), false);
    assert.equal(lines.some((line) => line.lrc === "监制：Yang"), true);
    assert.equal(lines.some((line) => line.lrc === "张亮"), true);
}

{
    const originalResolveFilename = Module._resolveFilename;
    Module._resolveFilename = function resolveRepoAlias(
        request,
        parent,
        isMain,
        options,
    ) {
        let resolvedRequest = request;
        if (request.startsWith("@/")) {
            resolvedRequest = path.resolve(__dirname, "../src", request.slice(2));
        } else if (request.startsWith("@shared/")) {
            resolvedRequest = path.resolve(
                __dirname,
                "../src/shared",
                request.slice("@shared/".length),
            );
        }
        return originalResolveFilename.call(
            this,
            resolvedRequest,
            parent,
            isMain,
            options,
        );
    };

    try {
        const { mapLyricLinesToAml } = require("../src/common/amll-lyric");
        const [mappedLine] = mapLyricLinesToAml([{
            endTime: 2,
            isBG: true,
            isDuet: true,
            lrc: "background",
            time: 1,
        }]);
        assert.equal(mappedLine.isBG, true);
        assert.equal(mappedLine.isDuet, true);

        const retainedCredits = mapLyricLinesToAml([{
            endTime: 2,
            lrc: "监制：Yang",
            time: 1,
        }, {
            endTime: 3,
            lrc: "张亮",
            time: 2,
        }]);
        assert.deepEqual(
            retainedCredits.map((line) => line.words[0].word),
            ["监制：Yang", "张亮"],
        );
    } finally {
        Module._resolveFilename = originalResolveFilename;
    }
}

console.log("lyric-duet: all assertions passed");

const assert = require("node:assert/strict");
const {
    DOMImplementation,
    DOMParser,
    XMLSerializer,
} = require("@xmldom/xmldom");

global.DOMParser = DOMParser;
global.document = { implementation: new DOMImplementation() };
global.XMLSerializer = XMLSerializer;

const LyricParser = require("../src/renderer/utils/lyric-parser").default;
const {
    serializeEmbeddedLyric,
} = require("../src/renderer/utils/embedded-lyric");

function parse(raw, format) {
    return new LyricParser(raw, { format }).getLyricItems();
}

{
    const [line] = parse("[00:01.000]Line lyric", "lrc");
    assert.equal(line.lrc, "Line lyric");
    assert.equal(line.time, 1);
    assert.equal(line.endTime, 4);
    assert.equal(line.hasWordTimeline, false);
    assert.equal(line.isVirtualWords, true);
}

{
    const [line] = parse(
        "[00:01.000]<00:01.000>Hello <00:01.500>world<00:02.000>",
        "lrc-a2",
    );
    assert.equal(line.lrc, "Hello world");
    assert.equal(line.hasWordTimeline, true);
    assert.deepEqual(line.words.map((word) => word.text), ["Hello ", "world"]);
}

{
    const [line] = parse(
        "[1000,1000](1000,400,0)逐(1400,600,0)字",
        "yrc",
    );
    assert.equal(line.lrc, "逐字");
    assert.equal(line.endTime, 2);
    assert.equal(line.hasWordTimeline, true);
}

{
    const [line] = parse(
        "[1000,1000]Word (1000,400)time(1400,600)",
        "qrc",
    );
    assert.equal(line.lrc, "Word time");
    assert.equal(line.words.length, 2);
}

{
    const [line] = parse(
        "[1000,1000]（Back(1000,400)ground）(1400,600)",
        "qrc",
    );
    assert.equal(line.lrc, "Background");
    assert.equal(line.isBG, true);
}

{
    const [line] = parse(
        "[00:01.000]ES[00:01.400]Lyric[00:02.000]",
        "eslrc",
    );
    assert.equal(line.lrc, "ESLyric");
    assert.equal(line.hasWordTimeline, true);
}

{
    const lines = parse([
        "[00:10.000]da [00:10.100][00:10.150]'t te[00:10.500]",
        "[00:10.000]だ[00:10.100][00:10.150]って[00:10.500]",
        "[00:10.000]原文翻译[00:10.800]",
        "[00:11.000]保[00:11.200][00:11.201]留[00:11.500]",
    ].join("\n"), "eslrc");

    assert.equal(lines.length, 2);
    assert.equal(lines[0].lrc, "だって");
    assert.equal(lines[0].romanization, "da 't te");
    assert.equal(lines[0].translation, "原文翻译");
    assert.equal(lines[1].lrc, "保留");
}

{
    const lines = parse([
        "[00:45.850]Original",
        "[00:45.850]Translation",
        "[00:49.600]Next line",
    ].join("\n"), "lrc");

    assert.equal(lines[0].endTime, 49.6);
    assert.equal(lines[0].duration, 3.75);
}

// QQ 逐字歌词的翻译由插件作为独立字段返回。重复副歌的译文时间戳会
// 错挂到上一组中文原文，应该移动到后面再次出现的英文原句。
{
    const parser = new LyricParser([
        "[01:40.861]<01:40.861>I <01:41.053>miss <01:41.390>you <01:41.797>thousand <01:42.053>times<01:42.406>",
        "[01:42.557]<01:42.557>周<01:42.701>兴<01:42.814>哲<01:42.942>：<01:43.033>Thousand <01:43.249>times <01:43.609>plus <01:43.761>one<01:44.075>",
        "[01:44.250]<01:44.250>我<01:44.419>打<01:44.570>的<01:44.763>左<01:44.922>转<01:45.146>弯<01:45.371>的<01:45.635>灯<01:45.810>",
        "[01:45.947]<01:45.947>合<01:46.098>：<01:46.098>但<01:46.258>我<01:46.482>在<01:46.626>往<01:46.746>右<01:46.986>转<01:47.180>",
        "[01:55.192]<01:55.192>周<01:55.303>兴<01:55.392>哲<01:55.504>：<01:55.504>I <01:55.656>miss <01:55.944>you <01:56.282>thousand <01:56.498>times<01:56.898>",
        "[01:57.011]<01:57.011>汪<01:57.129>苏<01:57.217>泷<01:57.306>：<01:57.370>Thousand <01:57.506>times <01:58.194>plus <01:58.394>one<01:58.798>",
    ].join("\n"), {
        format: "lrc-a2",
        translation: [
            "[01:40.861]我想你 千千万万遍",
            "[01:42.557]千遍万遍 还要再加一遍",
            "[01:44.250]我想你 千千万万遍",
            "[01:45.947]千遍万遍 还要再加一遍",
        ].join("\n"),
    });

    assert.deepEqual(
        parser.getLyricItems().map((line) => [line.lrc, line.translation]),
        [
            ["I miss you thousand times", "我想你 千千万万遍"],
            ["周兴哲：Thousand times plus one", "千遍万遍 还要再加一遍"],
            ["我打的左转弯的灯", undefined],
            ["合：但我在往右转", undefined],
            ["周兴哲：I miss you thousand times", "我想你 千千万万遍"],
            ["汪苏泷：Thousand times plus one", "千遍万遍 还要再加一遍"],
        ],
    );
    assert.equal(parser.hasTranslation, true);
}

// QQ 下载后的 .lrc 会把逐字原文和普通翻译行交错写在同一个 rawLrc 中。
// 重复副歌前的两行翻译不能绑定到中间的中文原文，而应归回后面的英文行。
{
    const parser = new LyricParser([
        "[01:40.861]<01:40.861>I <01:41.053>miss <01:41.390>you <01:41.797>thousand <01:42.053>times<01:42.406>",
        "[01:40.861]我想你 千千万万遍",
        "[01:42.557]<01:42.557>周<01:42.701>兴<01:42.814>哲<01:42.942>：<01:43.033>Thousand <01:43.249>times <01:43.609>plus <01:43.761>one<01:44.075>",
        "[01:42.557]千遍万遍 还要再加一遍",
        "[01:44.250]<01:44.250>我<01:44.419>打<01:44.570>的<01:44.763>左<01:44.922>转<01:45.146>弯<01:45.371>的<01:45.635>灯<01:45.810>",
        "[01:44.250]我想你 千千万万遍",
        "[01:45.947]<01:45.947>合<01:46.098>：<01:46.098>但<01:46.258>我<01:46.482>在<01:46.626>往<01:46.746>右<01:46.986>转<01:47.180>",
        "[01:45.947]千遍万遍 还要再加一遍",
        "[01:55.192]<01:55.192>周<01:55.303>兴<01:55.392>哲<01:55.504>：<01:55.504>I <01:55.656>miss <01:55.944>you <01:56.282>thousand <01:56.498>times<01:56.898>",
        "[01:57.011]<01:57.011>汪<01:57.129>苏<01:57.217>泷<01:57.306>：<01:57.370>Thousand <01:57.506>times <01:58.194>plus <01:58.394>one<01:58.798>",
    ].join("\n"), { format: "lrc-a2" });

    assert.deepEqual(
        parser.getLyricItems().map((line) => [line.lrc, line.translation]),
        [
            ["I miss you thousand times", "我想你 千千万万遍"],
            ["周兴哲：Thousand times plus one", "千遍万遍 还要再加一遍"],
            ["我打的左转弯的灯", undefined],
            ["合：但我在往右转", undefined],
            ["周兴哲：I miss you thousand times", "我想你 千千万万遍"],
            ["汪苏泷：Thousand times plus one", "千遍万遍 还要再加一遍"],
        ],
    );
}

// 网易云逐行歌词会把无冒号的演唱者标记单独占一行；同时间戳的翻译应
// 附着到后面实际的原文，而不是附着到“周兴哲/汪苏泷”这条标记上。
{
    const parser = new LyricParser([
        "[01:40.740]I miss you thousand times",
        "[01:40.740]我想你，千千万万遍",
        "[01:42.870]周兴哲",
        "[01:42.870]千遍万遍，还要再加一遍",
        "[01:43.050]Thousand times plus one",
        "[01:45.000]我打的左转弯的灯",
        "[01:45.000]我想你，千千万万遍",
        "[01:45.870]合：但我在往右转",
        "[01:54.900]周兴哲",
        "[01:55.350]I miss you thousand times",
        "[01:57.570]汪苏泷",
        "[01:57.570]千遍万遍，还要再加一遍",
        "[01:57.750]Thousand times plus one",
    ].join("\n"), {
        format: "lrc",
        musicItem: {
            artist: "汪苏泷, 周兴哲",
            id: "3416258008",
            platform: "网易云音乐",
            title: "左转灯 (1000 Times +1) (Live)",
        },
    });

    assert.deepEqual(
        parser.getLyricItems().map((line) => [line.lrc, line.translation]),
        [
            ["I miss you thousand times", "我想你，千千万万遍"],
            ["周兴哲：Thousand times plus one", "千遍万遍，还要再加一遍"],
            ["我打的左转弯的灯", undefined],
            ["合：但我在往右转", undefined],
            ["周兴哲：I miss you thousand times", "我想你，千千万万遍"],
            ["汪苏泷：Thousand times plus one", "千遍万遍，还要再加一遍"],
        ],
    );
}

// 网易云有歌曲的 lrc 字段会返回无 t 时间的 JSON 行，并把原文、译文
// 按固定间隔交替排列。JSON 元数据应先还原为文本，再按两行一组归位。
{
    const lines = parse([
        "[00:00.000]{\"c\":[{\"tx\":\"作词: \"},{\"tx\":\"勤勉之人\"}]}",
        "[00:03.000]{\"c\":[{\"tx\":\"作曲: \"},{\"tx\":\"勤勉之人\"}]}",
        "[00:06.000]{\"c\":[{\"tx\":\"编曲: \"},{\"tx\":\"勤勉之人\"}]}",
        "[00:09.000]えっ、私の声庫買ってくれたの",
        "[00:12.000]诶，你买了我的声库呢",
        "[00:15.000]ありがとう",
        "[00:18.000]谢谢你",
        "[00:21.000]でも",
        "[00:24.000]但是",
    ].join("\n"), "lrc");

    assert.deepEqual(
        lines.map((line) => [line.time, line.lrc, line.translation]),
        [
            [0, "作词: 勤勉之人", undefined],
            [3, "作曲: 勤勉之人", undefined],
            [6, "编曲: 勤勉之人", undefined],
            [9, "えっ、私の声庫買ってくれたの", "诶，你买了我的声库呢"],
            [15, "ありがとう", "谢谢你"],
            [21, "でも", "但是"],
        ],
    );
}

{
    const lines = parse([
        "[00:15.268]p[00:15.268]v[00:15.268]：[00:15.268]Fixture[00:15.278]",
        "[00:15.288]首[00:15.608]句[00:16.000]",
    ].join("\n"), "eslrc");

    assert.equal(lines.length, 2);
    assert.equal(lines[0].lrc, "pv：Fixture");
    assert.equal(lines[0].translation, undefined);
    assert.equal(lines[1].lrc, "首句");
}

{
    const [line] = parse(
        "[type:LyricifyLines]\n[1000,2000]Lyricify Lines",
        "lyl",
    );
    assert.equal(line.lrc, "Lyricify Lines");
    assert.equal(line.endTime, 2);
    assert.equal(line.isVirtualWords, true);
}

{
    const [line] = parse("[5]Right(1000,500) side(1500,500)", "lys");
    assert.equal(line.lrc, "Right side");
    assert.equal(line.isDuet, true);
    assert.equal(line.hasWordTimeline, true);
}

{
    const lines = parse([
        "[Lyricify Quick Export]",
        "[version:1.0]",
        "",
        "[lyrics: format@Lyricify Syllable]",
        "[4]Original(1000,1000)",
        "",
        "[translation: format@LRC]",
        "[00:01.000]Translation",
        "",
        "[pronunciation: format@LRC, language@romaji]",
        "[00:01.000]Romanization",
    ].join("\n"), "lqe");
    assert.equal(lines[0].translation, "Translation");
    assert.equal(lines[0].romanization, "Romanization");
}

{
    const ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"
    xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
    xmlns:tts="http://www.w3.org/ns/ttml#styling"
    xmlns:itunes="http://music.apple.com/lyric-ttml-internal"
    xmlns:amll="http://www.example.com/ns/amll"
    xml:lang="ja" itunes:timing="Word">
  <head>
    <metadata>
      <ttm:title>TTML Song</ttm:title>
      <ttm:agent xml:id="v1" type="person"><ttm:name type="full">Singer</ttm:name></ttm:agent>
      <iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
        <translations>
          <translation xml:lang="zh-Hans" type="subtitle"><text for="L1">今天</text></translation>
        </translations>
        <transliterations>
          <transliteration xml:lang="ja-Latn">
            <text for="L1"><span begin="00:01.000" end="00:01.500">kyo</span><span begin="00:01.500" end="00:02.000">u</span></text>
          </transliteration>
        </transliterations>
      </iTunesMetadata>
    </metadata>
  </head>
  <body><div><p begin="00:01.000" end="00:02.000" itunes:key="L1" ttm:agent="v1">
    <span tts:ruby="container"><span tts:ruby="base">今</span><span tts:ruby="textContainer"><span tts:ruby="text" begin="00:01.000" end="00:01.500">きょ</span></span></span><span begin="00:01.500" end="00:02.000">日</span>
    <span ttm:role="x-bg" begin="00:01.200" end="00:01.800"><span begin="00:01.200" end="00:01.800">背景</span></span>
  </p></div></body>
</tt>`;
    const parser = new LyricParser(ttml, { format: "ttml" });
    const lines = parser.getLyricItems();

    assert.equal(lines.length, 2);
    assert.equal(lines[0].lrc, "今日");
    assert.equal(lines[0].translation, "今天");
    assert.equal(lines[0].words[0].romanWord, "kyo");
    assert.equal(lines[0].words[1].romanWord, "u");
    assert.equal(lines[0].words[0].ruby[0].text, "きょ");
    assert.equal(lines[1].lrc, "背景");
    assert.equal(lines[1].isBG, true);
    assert.equal(parser.getMeta().musicName, "TTML Song");
}

{
    const serialized = serializeEmbeddedLyric({
        getLyricItems: () => [{
            time: 1,
            endTime: 2,
            duration: 1,
            index: 0,
            lrc: "Main lyric",
            translation: "主歌词",
            romanization: "main lyric",
            hasWordTimeline: true,
            words: [{
                text: "Main ",
                startTime: 1,
                endTime: 1.5,
                duration: 0.5,
                index: 0,
                romanWord: "main ",
            }, {
                text: "lyric",
                startTime: 1.5,
                endTime: 2,
                duration: 0.5,
                index: 1,
                romanWord: "lyric",
            }],
        }, {
            time: 1.2,
            endTime: 1.8,
            duration: 0.6,
            index: 1,
            lrc: "Background",
            isBG: true,
        }],
        getMeta: () => ({ musicName: "Embedded Fixture" }),
    });
    const roundTrip = new LyricParser(serialized, { format: "ttml" });
    const lines = roundTrip.getLyricItems();

    assert.match(serialized, /<tt[\s>]/);
    assert.doesNotMatch(serialized, /xmlns=""/);
    assert.equal(lines[0].lrc, "Main lyric");
    assert.equal(lines[0].translation, "主歌词");
    assert.equal(lines[0].romanization, "main lyric");
    assert.equal(lines[0].hasWordTimeline, true);
    assert.equal(lines[1].lrc, "Background");
    assert.equal(lines[1].isBG, true);
    assert.equal(roundTrip.getMeta().musicName, "Embedded Fixture");

    const browserNamespaceReset = serialized
        .replace("<head>", "<head xmlns=\"\">")
        .replace("<body ", "<body xmlns=\"\" ");
    const repairedLines = new LyricParser(
        browserNamespaceReset,
        { format: "ttml" },
    ).getLyricItems();
    assert.equal(repairedLines[0].lrc, "Main lyric");
    assert.equal(repairedLines[1].lrc, "Background");
}

// [offset:] 必须在解析时一次性并入时间轴：以前只有 getPosition 单独减 offset，
// 挑行是校正过的，而 lineProgress、词级进度和 AMLL 视图全用未校正时间。
{
    const parser = new LyricParser(
        "[offset:5000]\n[00:10.00]line A\n[00:20.00]line B",
    );
    const items = parser.getLyricItems();
    assert.deepEqual(items.map((item) => item.time), [15, 25]);
    // 并入后必须清掉 meta.offset，否则导出的歌词会再偏移一次。
    assert.equal(parser.getMeta().offset, undefined);
    const state = parser.getActiveState(16);
    assert.equal(state.line.lrc, "line A");
    // (16 - 15) / 10 = 0.1；修复前这里是 (16 - 10) / 10 = 0.6。
    assert.ok(Math.abs(state.lineProgress - 0.1) < 1e-6, String(state.lineProgress));
    assert.equal(parser.getPosition(16).lrc, "line A");
    assert.equal(parser.getPosition(14), null);
}

// 用户偏移必须同时作用于行级和逐字时间轴，并且反复调整按绝对值计算。
{
    const parser = new LyricParser(
        "[00:01.000]<00:01.000>Hello <00:01.500>world<00:02.000>",
        { format: "lrc-a2", timeOffset: 0.4 },
    );
    let [line] = parser.getLyricItems();
    assert.equal(line.time, 1.4);
    assert.equal(line.words[0].startTime, 1.4);
    assert.equal(parser.getTimeOffset(), 0.4);

    parser.setTimeOffset(-0.2);
    [line] = parser.getLyricItems();
    assert.ok(Math.abs(line.time - 0.8) < 1e-6);
    assert.ok(Math.abs(line.words[0].startTime - 0.8) < 1e-6);
    assert.equal(parser.getTimeOffset(), -0.2);
}

// TTML 罗马音按过滤前的行下标配对：空文本行会被 convertAmlLyricLines 丢掉，
// 用过滤后的数组位置会让后面每行都拿到前一行的音译。
{
    // 第一行是空文本的间隔行（本应用自己导出的 TTML 就会包含这种行）。
    const ttml = [
        "<tt xmlns=\"http://www.w3.org/ns/ttml\"",
        " xmlns:ttm=\"http://www.w3.org/ns/ttml#metadata\"",
        " xmlns:itunes=\"http://music.apple.com/lyric-ttml-internal\"><body><div>",
        "<p begin=\"00:00:00.500\" end=\"00:00:01.000\" itunes:key=\"L1\"></p>",
        "<p begin=\"00:00:01.000\" end=\"00:00:03.000\" itunes:key=\"L2\">",
        "<span begin=\"00:00:01.000\" end=\"00:00:03.000\">こんにちは</span>",
        "<span ttm:role=\"x-translation\" xml:lang=\"zh\">你好</span>",
        "<span ttm:role=\"x-roman\">konnichiwa</span></p>",
        "<p begin=\"00:00:05.000\" end=\"00:00:07.000\" itunes:key=\"L3\">",
        "<span begin=\"00:00:05.000\" end=\"00:00:07.000\">さようなら</span>",
        "<span ttm:role=\"x-roman\">sayounara</span></p>",
        "</div></body></tt>",
    ].join("");
    const items = new LyricParser(ttml, { format: "ttml" }).getLyricItems();
    const romanizationByText = new Map(
        items.map((item) => [item.lrc, item.romanization]),
    );
    assert.equal(romanizationByText.get("こんにちは"), "konnichiwa");
    assert.equal(romanizationByText.get("さようなら"), "sayounara");
}

console.log("lyric-formats: all assertions passed");

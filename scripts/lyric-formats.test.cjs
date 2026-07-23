const assert = require("node:assert/strict");
const { DOMParser } = require("@xmldom/xmldom");

global.DOMParser = DOMParser;

const LyricParser = require("../src/renderer/utils/lyric-parser").default;

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

console.log("lyric-formats: all assertions passed");

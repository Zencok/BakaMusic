declare module "@ungap/structured-clone" {
  const structuredClone: <T>(value: T) => T;
  export default structuredClone;
}

declare module "bezier-easing" {
  type BezierEasingFn = (value: number) => number;

  export default function bezier(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): BezierEasingFn;
}

declare module "unzipper/lib/parse" {
  import type { ParseOptions, ParseStream } from "unzipper";

  function createUnzipParser(options?: ParseOptions): ParseStream;

  export = createUnzipParser;
}

declare module "@amll-core/interfaces" {
  export interface LyricWordBase {
    startTime: number;
    endTime: number;
    word: string;
  }

  export interface LyricWord extends LyricWordBase {
    romanWord?: string;
    obscene?: boolean;
    ruby?: LyricWordBase[];
  }

  export interface LyricLine {
    words: LyricWord[];
    translatedLyric: string;
    romanLyric: string;
    startTime: number;
    endTime: number;
    isBG: boolean;
    isDuet: boolean;
  }
}

declare module "@amll-core/lyric-player/index" {
  export const MaskObsceneWordsMode: {
    readonly Disabled: "";
    readonly FullMask: "full-mask";
    readonly PartialMask: "partial-mask";
  };
}

declare module "@amll-core/lyric-player/dom/index" {
  import type { LyricLine } from "@amll-core/interfaces";

  export interface LyricLineHandle {
    getLine(): LyricLine;
    getElement(): HTMLElement;
  }

  export class LyricLineMouseEvent extends MouseEvent {
    readonly lineIndex: number;
    readonly line: LyricLineHandle;
    readonly bgLine?: LyricLineHandle;
  }

  export class DomLyricPlayer extends EventTarget {
    getElement(): HTMLElement;
    setMaskObsceneWords(mode: unknown): void;
    setLineClickEnabled(enabled?: boolean): void;
    setAlignAnchor(alignAnchor: "top" | "bottom" | "center"): void;
    setAlignPosition(alignPosition: number): void;
    setCenterInterludeDots(center?: boolean): void;
    setEnableBlur(enable?: boolean): void;
    setEnableScale(enable?: boolean): void;
    setEnableSpring(enable?: boolean): void;
    setHidePassedLines(hide: boolean): void;
    setWordFadeWidth(value?: number): void;
    setInactiveBrightness(value?: number): void;
    setLyricLines(lines: LyricLine[], initialTime?: number): void;
    setCurrentTime(time: number, isSeek?: boolean): void;
    update(delta?: number): void;
    pause(): void;
    resume(): void;
    dispose(): void;
  }
}

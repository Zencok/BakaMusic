import { DomLyricPlayer } from "./dom/index.ts";
import { LyricLineRenderMode, MaskObsceneWordsMode } from "./enums.ts";

export { LyricPlayerBase } from "./base.ts";
export * from "./canvas/index.ts";
export * from "./dom/index.ts";
export * from "./dom-slim/index.ts";

export {
	/**
	 * 默认导出的歌词播放器组件
	 */
	DomLyricPlayer as LyricPlayer,
	LyricLineRenderMode,
	MaskObsceneWordsMode,
};

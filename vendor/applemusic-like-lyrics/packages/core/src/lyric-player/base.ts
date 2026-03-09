import structuredClone from "@ungap/structured-clone";
import type {
	Disposable,
	HasElement,
	LyricLine,
	LyricWord,
	OptimizeLyricOptions,
} from "../interfaces.ts";
import styles from "../styles/lyric-player.module.css";
import { eqSet } from "../utils/eq-set.ts";
import { isCJK } from "../utils/is-cjk.ts";
import { optimizeLyricLines } from "../utils/optimize-lyric.ts";
import { Spring, type SpringParams } from "../utils/spring.ts";
import { BottomLineEl } from "./bottom-line.ts";
import { InterludeDots } from "./dom/interlude-dots.ts";
import { LyricLineRenderMode, MaskObsceneWordsMode } from "./enums.ts";

/**
 * 姝岃瘝鎾斁鍣ㄧ殑鍩虹被锛屽凡缁忓寘鍚簡鏈夊叧姝岃瘝鎿嶄綔鍜屾帓鐗堢殑鍔熻兘锛屽瓙绫婚渶瑕佷负鍏跺疄鐜板搴旂殑鏄剧ず灞曠ず鎿嶄綔
 */
export abstract class LyricPlayerBase
	extends EventTarget
	implements HasElement, Disposable
{
	protected element: HTMLElement = document.createElement("div");
	abstract get baseFontSize(): number;

	protected currentTime = 0;
	/** @internal */
	lyricLinesSize: WeakMap<LyricLineBase, [number, number]> = new WeakMap();
	/** @internal */
	lyricLineElementMap: WeakMap<Element, LyricLineBase> = new WeakMap();
	protected currentLyricLines: LyricLine[] = [];
	// protected currentLyricLineObjects: LyricLineBase[] = [];
	protected processedLines: LyricLine[] = [];
	protected lyricLinesIndexes: WeakMap<LyricLineBase, number> = new WeakMap();
	protected hotLines: Set<number> = new Set();
	protected bufferedLines: Set<number> = new Set();
	protected isNonDynamic = false;
	protected hasDuetLine = false;
	protected scrollToIndex = 0;
	protected disableSpring = false;
	protected interludeDotsSize: [number, number] = [0, 0];
	protected interludeDots: InterludeDots = new InterludeDots();
	protected bottomLine: BottomLineEl = new BottomLineEl(this);
	protected enableBlur = true;
	protected enableScale = true;
	protected maskObsceneWords = MaskObsceneWordsMode.Disabled;
	protected maskObsceneWordChar = "*";
	protected hidePassedLines = false;
	protected scrollBoundary = [0, 0];
	protected currentLyricLineObjects: LyricLineBase[] = [];
	protected isSeeking = false;
	protected lastCurrentTime = 0;
	protected alignAnchor: "top" | "bottom" | "center" = "center";
	protected alignPosition = 0.35;
	protected scrollOffset = 0;
	readonly size: [number, number] = [0, 0];
	protected allowScroll = true;
	protected isPageVisible = true;
	protected optimizeOptions: OptimizeLyricOptions = {};

	protected initialLayoutFinished = false;

	/**
	 * 鏍囪鐢ㄦ埛鏄惁姝ｅ湪杩涜婊氬姩浜や簰
	 */
	protected isUserScrolling = false;
	protected wheelTimeout: ReturnType<typeof setTimeout> | undefined;

	/**
	 * 瑙嗗浘棰濆棰勬覆鏌擄紙overscan锛夎窛绂伙紝鍗曚綅锛氬儚绱犮€?
	 * 鐢ㄤ簬鍐冲畾鍦ㄨ鍙ｄ箣澶栧灏戣窛绂诲唴涔熻涓烘槸鈥滃彲瑙佲€濓紝浠ヤ究鎻愬墠鍒涘缓/淇濈暀琛屽厓绱犮€?
	 */
	protected overscanPx = 300;

	protected posXSpringParams: Partial<SpringParams> = {
		mass: 1,
		damping: 10,
		stiffness: 100,
	};
	protected posYSpringParams: Partial<SpringParams> = {
		mass: 0.9,
		damping: 15,
		stiffness: 90,
	};
	protected scaleSpringParams: Partial<SpringParams> = {
		mass: 2,
		damping: 25,
		stiffness: 100,
	};
	protected scaleForBGSpringParams: Partial<SpringParams> = {
		mass: 1,
		damping: 20,
		stiffness: 50,
	};
	private onPageShow = () => {
		this.isPageVisible = true;
		this.setCurrentTime(this.currentTime, true);
	};
	private onPageHide = () => {
		this.isPageVisible = false;
	};
	private scrolledHandler = 0;
	protected isScrolled = false;
	private resizeObserverFrame = 0;
	private pendingResizeRelayout = false;
	private pendingResizeStyleRebuild = false;
	private flushResizeObserverChanges = () => {
		this.resizeObserverFrame = 0;

		const shouldRelayout = this.pendingResizeRelayout;
		const shouldRebuildPlayerStyle = this.pendingResizeStyleRebuild;

		this.pendingResizeRelayout = false;
		this.pendingResizeStyleRebuild = false;

		if (shouldRelayout) {
			this.calcLayout(true);
		}
		if (shouldRebuildPlayerStyle) {
			this.onResize();
		}
	};
	/** @internal */
	resizeObserver: ResizeObserver = new ResizeObserver(((entries) => {
		let shouldRelayout = false;
		let shouldRebuildPlayerStyle = false;
		for (const entry of entries) {
			if (entry.target === this.element) {
				const rect = entry.contentRect;
				this.size[0] = rect.width;
				this.size[1] = rect.height;
				shouldRebuildPlayerStyle = true;
			} else if (entry.target === this.interludeDots.getElement()) {
				this.interludeDotsSize[0] = entry.target.clientWidth;
				this.interludeDotsSize[1] = entry.target.clientHeight;
				shouldRelayout = true;
			} else if (entry.target === this.bottomLine.getElement()) {
				const newSize: [number, number] = [
					entry.target.clientWidth,
					entry.target.clientHeight,
				];
				const oldSize: [number, number] = this.bottomLine.lineSize;

				if (newSize[0] !== oldSize[0] || newSize[1] !== oldSize[1]) {
					this.bottomLine.lineSize = newSize;
					shouldRelayout = true;
				}
			} else {
				const lineObj = this.lyricLineElementMap.get(entry.target);
				if (lineObj) {
					const newSize: [number, number] = [
						entry.target.clientWidth,
						entry.target.clientHeight,
					];
					const oldSize: [number, number] = this.lyricLinesSize.get(
						lineObj,
					) ?? [0, 0];

					if (newSize[0] !== oldSize[0] || newSize[1] !== oldSize[1]) {
						this.lyricLinesSize.set(lineObj, newSize);
						lineObj.onLineSizeChange(newSize);
						shouldRelayout = true;
					}
				}
			}
		}
		if (shouldRelayout) {
			this.pendingResizeRelayout = true;
		}
		if (shouldRebuildPlayerStyle) {
			this.pendingResizeStyleRebuild = true;
		}
		if (
			(this.pendingResizeRelayout || this.pendingResizeStyleRebuild) &&
			!this.resizeObserverFrame
		) {
			this.resizeObserverFrame = requestAnimationFrame(
				this.flushResizeObserverChanges,
			);
		}
	}) as ResizeObserverCallback);
	protected wordFadeWidth = 0.5;
	protected targetAlignIndex = 0;

	constructor(element?: HTMLElement) {
		super();
		if (element) this.element = element;
		this.element.classList.add("amll-lyric-player");

		this.resizeObserver.observe(this.element);
		this.resizeObserver.observe(this.interludeDots.getElement());

		this.element.appendChild(this.interludeDots.getElement());
		this.element.appendChild(this.bottomLine.getElement());
		this.interludeDots.setTransform(0, 200);

		window.addEventListener("pageshow", this.onPageShow);
		window.addEventListener("pagehide", this.onPageHide);

		let startScrollY = 0;

		let startTouchPosY = 0;
		let startTouchStartX = 0;
		let startTouchStartY = 0;

		let lastMoveY = 0;
		let startScrollTime = 0;
		let scrollSpeed = 0;
		let curScrollId = 0;

		this.element.addEventListener("touchstart", (evt) => {
			if (this.beginScrollHandler()) {
				this.isUserScrolling = true;

				evt.preventDefault();
				startScrollY = this.scrollOffset;

				startTouchPosY = evt.touches[0].screenY;
				lastMoveY = startTouchPosY;

				startTouchStartX = evt.touches[0].screenX;
				startTouchStartY = evt.touches[0].screenY;

				startScrollTime = Date.now();
				scrollSpeed = 0;

				this.calcLayout(true, true);
			}
		});

		this.element.addEventListener("touchmove", (evt) => {
			if (this.beginScrollHandler()) {
				evt.preventDefault();
				const currentY = evt.touches[0].screenY;

				const deltaY = currentY - startTouchPosY;
				this.scrollOffset = startScrollY - deltaY;
				this.limitScrollOffset();

				const now = Date.now();
				const dt = now - startScrollTime;
				if (dt > 0) {
					scrollSpeed = (currentY - lastMoveY) / dt;
				}
				lastMoveY = currentY;
				startScrollTime = now;

				this.calcLayout(true, true);
			}
		});

		this.element.addEventListener("touchend", (evt) => {
			if (this.beginScrollHandler()) {
				evt.preventDefault();

				const touch = evt.changedTouches[0];
				const moveX = Math.abs(touch.screenX - startTouchStartX);
				const moveY = Math.abs(touch.screenY - startTouchStartY);

				if (moveX < 10 && moveY < 10) {
					const target = document.elementFromPoint(
						touch.clientX,
						touch.clientY,
					);
					if (target && this.element.contains(target)) {
						(target as HTMLElement).click();
					}
					this.isUserScrolling = false;
					this.endScrollHandler();
					return;
				}

				startTouchPosY = 0;
				const scrollId = ++curScrollId;

				if (Math.abs(scrollSpeed) < 0.1) scrollSpeed = 0;

				let lastFrameTime = performance.now();

				const onScrollFrame = (time: number) => {
					if (scrollId !== curScrollId) return;

					const dt = time - lastFrameTime;
					lastFrameTime = time;

					if (dt <= 0 || dt > 100) {
						requestAnimationFrame(onScrollFrame);
						return;
					}

					if (Math.abs(scrollSpeed) > 0.05) {
						this.scrollOffset -= scrollSpeed * dt;

						this.limitScrollOffset();

						const frictionFactor = 0.95 ** (dt / 16);
						scrollSpeed *= frictionFactor;

						this.calcLayout(true, true);

						requestAnimationFrame(onScrollFrame);
					} else {
						this.isUserScrolling = false;
						this.endScrollHandler();
					}
				};

				requestAnimationFrame(onScrollFrame);
			} else {
				this.isUserScrolling = false;
			}
		});

		this.element.addEventListener(
			"wheel",
			(evt) => {
				if (this.beginScrollHandler()) {
					evt.preventDefault();
					// this.isUserScrolling = true;

					if (evt.deltaMode === evt.DOM_DELTA_PIXEL) {
						this.scrollOffset += evt.deltaY;
						this.limitScrollOffset();
						this.calcLayout(true, false);
					} else {
						this.scrollOffset += evt.deltaY * 50;
						this.limitScrollOffset();
						this.calcLayout(false, false);
					}

					// if (this.wheelTimeout) {
					// 	clearTimeout(this.wheelTimeout);
					// }

					// this.wheelTimeout = setTimeout(() => {
					// 	this.isUserScrolling = false;
					// 	this.endScrollHandler();
					// }, 150);
				}
			},
			{ passive: false },
		);
	}

	private beginScrollHandler() {
		const allowed = this.allowScroll;
		if (allowed) {
			this.isScrolled = true;
			clearTimeout(this.scrolledHandler);
			this.scrolledHandler = setTimeout(() => {
				this.isScrolled = false;
				this.scrollOffset = 0;
			}, 5000);
		}
		return allowed;
	}
	private endScrollHandler() {}
	private limitScrollOffset() {
		this.scrollOffset = Math.max(
			Math.min(this.scrollBoundary[1], this.scrollOffset),
			this.scrollBoundary[0],
		);
	}

	/**
	 * 璁剧疆鏂囧瓧鍔ㄧ敾鐨勬笎鍙樺搴︼紝鍗曚綅浠ユ瓕璇嶈鐨勪富鏂囧瓧瀛椾綋澶у皬鐨勫€嶆暟涓哄崟浣嶏紝榛樿涓?0.5锛屽嵆涓€涓叏瑙掑瓧绗︾殑涓€鍗婂搴?
	 *
	 * 濡傛灉瑕佹ā鎷?Apple Music for Android 鐨勬晥鏋滐紝鍙互璁剧疆涓?1
	 *
	 * 濡傛灉瑕佹ā鎷?Apple Music for iPad 鐨勬晥鏋滐紝鍙互璁剧疆涓?0.5
	 *
	 * 濡傛灉鎯宠杩戜箮绂佺敤娓愬彉鏁堟灉锛屽彲浠ヨ缃垚闈炲父鎺ヨ繎 0 鐨勫皬鏁帮紙渚嬪 `0.0001` 锛夛紝浣嗘槸**涓嶅彲浠ヤ负 0**
	 *
	 * @param value 闇€瑕佽缃殑娓愬彉瀹藉害锛屽崟浣嶄互姝岃瘝琛岀殑涓绘枃瀛楀瓧浣撳ぇ灏忕殑鍊嶆暟涓哄崟浣嶏紝榛樿涓?0.5
	 */
	setWordFadeWidth(value = 0.5) {
		this.wordFadeWidth = Math.max(0.0001, value);
	}

	/**
	 * 鏄惁鍚敤姝岃瘝琛岀缉鏀炬晥鏋滐紝榛樿鍚敤
	 *
	 * 濡傛灉鍚敤锛岄潪閫変腑鐨勬瓕璇嶈浼氳交寰缉灏忎互鍑告樉褰撳墠鎾斁姝岃瘝琛屾晥鏋?
	 *
	 * 姝ゆ晥鏋滃鎬ц兘褰卞搷寰箮鍏跺井锛屾帹鑽愬惎鐢?
	 * @param enable 鏄惁鍚敤姝岃瘝琛岀缉鏀炬晥鏋?
	 */
	setEnableScale(enable = true) {
		this.enableScale = enable;
		this.calcLayout();
	}
	/**
	 * 鑾峰彇褰撳墠鏄惁鍚敤浜嗘瓕璇嶈缂╂斁鏁堟灉
	 * @returns 鏄惁鍚敤姝岃瘝琛岀缉鏀炬晥鏋?
	 */
	getEnableScale() {
		return this.enableScale;
	}

	/**
	 * 鑾峰彇褰撳墠鏂囧瓧鍔ㄧ敾鐨勬笎鍙樺搴︼紝鍗曚綅浠ユ瓕璇嶈鐨勪富鏂囧瓧瀛椾綋澶у皬鐨勫€嶆暟涓哄崟浣?
	 * @returns 褰撳墠鏂囧瓧鍔ㄧ敾鐨勬笎鍙樺搴︼紝鍗曚綅浠ユ瓕璇嶈鐨勪富鏂囧瓧瀛椾綋澶у皬鐨勫€嶆暟涓哄崟浣?
	 */
	getWordFadeWidth() {
		return this.wordFadeWidth;
	}

	setIsSeeking(isSeeking: boolean) {
		this.isSeeking = isSeeking;
	}
	/**
	 * 璁剧疆鏄惁闅愯棌宸茬粡鎾斁杩囩殑姝岃瘝琛岋紝榛樿涓嶉殣钘?
	 * @param hide 鏄惁闅愯棌宸茬粡鎾斁杩囩殑姝岃瘝琛岋紝榛樿涓嶉殣钘?
	 */
	setHidePassedLines(hide: boolean) {
		this.hidePassedLines = hide;
		this.calcLayout();
	}
	/**
	 * 璁剧疆鏄惁鍚敤姝岃瘝琛岀殑妯＄硦鏁堟灉
	 * @param enable 鏄惁鍚敤
	 */
	setEnableBlur(enable: boolean) {
		if (this.enableBlur === enable) return;
		this.enableBlur = enable;
		this.calcLayout();
	}

	/**
	 * 璁剧疆姝岃瘝涓笉闆呯敤璇殑鎺╃爜妯″紡
	 * @param mode 鎺╃爜妯″紡
	 * @see {@link MaskObsceneWordsMode}
	 */
	setMaskObsceneWords(mode: MaskObsceneWordsMode) {
		if (this.maskObsceneWords === mode) return;
		this.maskObsceneWords = mode;
		this.rebuildLyricLines();
		this.calcLayout();
	}

	/**
	 * 璁剧疆涓嶉泤鐢ㄨ鎺╃爜浣跨敤鐨勫瓧绗︼紝榛樿涓?`*`
	 * @param char 鍗曚釜瀛楃锛岀敤浜庢浛鎹笉闆呯敤璇腑鐨勫瓧绗?
	 */
	setMaskObsceneWordChar(char: string) {
		const c = char.charAt(0) || "*";
		if (this.maskObsceneWordChar === c) return;
		this.maskObsceneWordChar = c;
		if (this.maskObsceneWords !== MaskObsceneWordsMode.Disabled) {
			this.rebuildLyricLines();
			this.calcLayout();
		}
	}

	rebuildLyricLines() {
		for (const lineObj of this.currentLyricLineObjects) {
			lineObj.rebuildElement();
		}
	}
	/**
	 * 鏍规嵁褰撳墠閰嶇疆澶勭悊涓嶉泤鐢ㄨ鍗曡瘝
	 * @param word 鍗曡瘝瀵硅薄
	 * @internal
	 */
	processObsceneWord(word: LyricWord): string {
		const text = word.word;

		if (
			!word.obscene ||
			this.maskObsceneWords === MaskObsceneWordsMode.Disabled
		) {
			return text;
		}

		const maskChar = this.maskObsceneWordChar;

		if (this.maskObsceneWords === MaskObsceneWordsMode.FullMask) {
			return text.replace(/\S/g, maskChar);
		}

		if (this.maskObsceneWords === MaskObsceneWordsMode.PartialMask) {
			const trimmed = text.trim();

			if (trimmed.length <= 2) {
				return text.replace(/\S/g, maskChar);
			}

			const startPos = text.indexOf(trimmed);
			const endPos = startPos + trimmed.length - 1;

			return (
				text.slice(0, startPos + 1) +
				text.slice(startPos + 1, endPos).replace(/\S/g, maskChar) +
				text.slice(endPos)
			);
		}

		return text;
	}
	/**
	 * 璁剧疆鐩爣姝岃瘝琛岀殑瀵归綈鏂瑰紡锛岄粯璁や负 `center`
	 *
	 * - 璁剧疆鎴?`top` 鐨勮瘽灏嗕細鍚戠洰鏍囨瓕璇嶈鐨勯《閮ㄥ榻?
	 * - 璁剧疆鎴?`bottom` 鐨勮瘽灏嗕細鍚戠洰鏍囨瓕璇嶈鐨勫簳閮ㄥ榻?
	 * - 璁剧疆鎴?`center` 鐨勮瘽灏嗕細鍚戠洰鏍囨瓕璇嶈鐨勫瀭鐩翠腑蹇冨榻?
	 * @param alignAnchor 姝岃瘝琛屽榻愭柟寮忥紝璇︽儏瑙佸嚱鏁拌鏄?
	 */
	setAlignAnchor(alignAnchor: "top" | "bottom" | "center") {
		this.alignAnchor = alignAnchor;
	}
	/**
	 * 璁剧疆榛樿鐨勬瓕璇嶈瀵归綈浣嶇疆锛岀浉瀵逛簬鏁翠釜姝岃瘝鎾斁缁勪欢鐨勫ぇ灏忎綅缃紝榛樿涓?`0.5`
	 * @param alignPosition 涓€涓?`[0.0-1.0]` 涔嬮棿鐨勪换鎰忔暟瀛楋紝浠ｈ〃缁勪欢楂樺害鐢变笂鍒颁笅鐨勬瘮渚嬩綅缃?
	 */
	setAlignPosition(alignPosition: number) {
		this.alignPosition = alignPosition;
	}

	/**
	 * 璁剧疆 overscan锛堣鍥句笂涓嬮澶栫紦鍐叉覆鏌撳尯锛夎窛绂伙紝鍗曚綅锛氬儚绱犮€?
	 * @param px 鍍忕礌鍊硷紝榛樿 300
	 */
	setOverscanPx(px: number) {
		this.overscanPx = Math.max(0, px | 0);
	}
	/** 鑾峰彇褰撳墠 overscan 鍍忕礌璺濈 */
	getOverscanPx() {
		return this.overscanPx;
	}
	/**
	 * 璁剧疆鏄惁浣跨敤鐗╃悊寮圭哀绠楁硶瀹炵幇姝岃瘝鍔ㄧ敾鏁堟灉锛岄粯璁ゅ惎鐢?
	 *
	 * 濡傛灉鍚敤锛屽垯浼氶€氳繃寮圭哀绠楁硶瀹炴椂澶勭悊姝岃瘝浣嶇疆锛屼絾鏄渶瑕佹€ц兘瓒冲寮哄姴鐨勭數鑴戞柟鍙祦鐣呰繍琛?
	 *
	 * 濡傛灉涓嶅惎鐢紝鍒欎細鍥為€€鍒板熀浜?`transition` 鐨勮繃娓℃晥鏋滐紝瀵逛綆鎬ц兘鐨勬満鍣ㄦ瘮杈冨弸濂斤紝浣嗘槸鏁堟灉浼氭瘮杈冨崟涓€
	 */
	setEnableSpring(enable = true) {
		this.disableSpring = !enable;
		if (enable) {
			this.element.classList.remove(styles.disableSpring);
		} else {
			this.element.classList.add(styles.disableSpring);
		}
		this.calcLayout(true);
	}
	/**
	 * 鑾峰彇褰撳墠鏄惁鍚敤浜嗙墿鐞嗗脊绨?
	 * @returns 鏄惁鍚敤鐗╃悊寮圭哀
	 */
	getEnableSpring() {
		return !this.disableSpring;
	}

	/**
	 * 鑾峰彇褰撳墠鎾斁鏃堕棿閲屾槸鍚﹀浜庨棿濂忓尯闂?
	 * 濡傛灉鏄垯浼氳繑鍥炲崟浣嶄负姣鐨勫鏈椂闂?
	 * 鍚﹀垯杩斿洖 undefined
	 *
	 * 杩欎釜鍙厑璁稿唴閮ㄨ皟鐢?
	 * @returns [寮€濮嬫椂闂?缁撴潫鏃堕棿,澶ф澶勪簬鐨勬瓕璇嶈ID,涓嬩竴鍙ユ槸鍚︿负瀵瑰敱姝岃瘝] 鎴?undefined 濡傛灉涓嶅浜庨棿濂忓尯闂?
	 */
	protected getCurrentInterlude():
		| [number, number, number, boolean]
		| undefined {
		const currentTime = this.currentTime + 20;
		const currentIndex = this.scrollToIndex;
		const lines = this.processedLines;

		const checkGap = (
			k: number,
		): [number, number, number, boolean] | undefined => {
			if (k < -1 || k >= lines.length - 1) return undefined;

			const prevLine = k === -1 ? null : lines[k];
			const nextLine = lines[k + 1];

			const gapStart = prevLine ? prevLine.endTime : 0;
			const gapEnd = Math.max(gapStart, nextLine.startTime - 250);

			if (gapEnd - gapStart < 4000) {
				return undefined;
			}

			if (gapEnd > currentTime && gapStart < currentTime) {
				return [Math.max(gapStart, currentTime), gapEnd, k, nextLine.isDuet];
			}
			return undefined;
		};

		return (
			checkGap(currentIndex - 1) ||
			checkGap(currentIndex) ||
			checkGap(currentIndex + 1)
		);
	}

	/**
	 * 璁剧疆姝岃瘝鐨勪紭鍖栭厤缃」锛岃繖浜涢厤缃」榛樿鍏ㄩ儴寮€鍚?
	 *
	 * 娉ㄦ剰锛屽鏋滃湪 `setLyricLines` 涔嬪悗淇敼姝ら厤缃紝闇€瑕侀噸鏂拌皟鐢?`setLyricLines()` 鎵嶈兘瀵瑰綋鍓嶆瓕璇嶇敓鏁?
	 * @param options 浼樺寲閰嶇疆閫夐」
	 * @see {@link OptimizeLyricOptions}
	 */
	setOptimizeOptions(options: OptimizeLyricOptions) {
		this.optimizeOptions = { ...this.optimizeOptions, ...options };
	}

	/**
	 * 璁剧疆褰撳墠鎾斁姝岃瘝锛岃娉ㄦ剰浼犲叆鍚庤繖涓暟缁勫唴鐨勪俊鎭笉寰椾慨鏀癸紝鍚﹀垯浼氬彂鐢熼敊璇?
	 * @param lines 姝岃瘝鏁扮粍
	 * @param initialTime 鍒濆鏃堕棿锛岄粯璁や负 0
	 */
	setLyricLines(lines: LyricLine[], initialTime = 0) {
		this.initialLayoutFinished = true;
		this.lastCurrentTime = initialTime;
		this.currentTime = initialTime;
		this.currentLyricLines = structuredClone(lines);
		this.processedLines = structuredClone(this.currentLyricLines);
		optimizeLyricLines(this.processedLines, this.optimizeOptions);

		this.isNonDynamic = true;
		for (const line of this.processedLines) {
			if (line.words.length > 1) {
				this.isNonDynamic = false;
				break;
			}
		}

		this.hasDuetLine = this.processedLines.some((line) => line.isDuet);

		for (const line of this.currentLyricLineObjects) {
			line.dispose();
		}

		this.interludeDots.setInterlude(undefined);
		this.hotLines.clear();
		this.bufferedLines.clear();
		this.setCurrentTime(0, true);

	}

	/**
	 * 鑾峰彇褰撳墠鏄惁鍦ㄦ挱鏀?
	 * @returns 褰撳墠鏄惁鍦ㄦ挱鏀?
	 */
	public getIsPlaying() {
		return this.isPlaying;
	}

	/**
	 * 璁剧疆褰撳墠鎾斁杩涘害锛屽崟浣嶄负姣涓?*蹇呴』鏄暣鏁?*锛屾鏃跺皢浼氭洿鏂板唴閮ㄧ殑姝岃瘝杩涘害淇℃伅
	 * 鍐呴儴浼氭牴鎹皟鐢ㄩ棿闅斿拰鎾斁杩涘害鑷姩鍐冲畾濡備綍婊氬姩鍜屾樉绀烘瓕璇嶏紝鎵€浠ヨ繖涓殑璋冪敤棰戠巼瓒婂揩瓒婂噯纭秺濂?
	 *
	 * 璋冪敤瀹屾垚鍚庯紝鍙互姣忓抚璋冪敤 `update` 鍑芥暟鏉ユ墽琛屾瓕璇嶅姩鐢绘晥鏋?
	 * @param time 褰撳墠鎾斁杩涘害锛屽崟浣嶄负姣
	 */
	setCurrentTime(time: number, isSeek = false) {
		// 鎴戝湪杩欓噷瀹氫箟浜嗘瓕璇嶇殑閫夋嫨鐘舵€侊細
		// 鏅€氳锛氬綋鍓嶄笉澶勪簬鏃堕棿鑼冨洿鍐呯殑姝岃瘝琛?
		// 鐑锛氬綋鍓嶇粷瀵瑰浜庢挱鏀炬椂闂村唴鐨勬瓕璇嶈锛屼笖涓€鑸細琚珛鍒诲姞鍏ュ埌缂撳啿琛屼腑
		// 缂撳啿琛岋細涓€鑸浜庢挱鏀炬椂闂村悗鐨勬瓕璇嶈锛屼細鍥犱负褰撳墠鎾斁鐘舵€佺殑缂樻晠鎺ㄨ繜瑙ｉ櫎鐘舵€?

		// 鐒跺悗鎴戜滑闇€瑕佽姝岃瘝琛屼负濡備笅锛?
		// 濡傛灉褰撳墠浠嶆湁缂撳啿琛岀殑鎯呭喌涓嬪姞鍏ユ柊鐑锛屽垯涓嶄細瑙ｉ櫎褰撳墠缂撳啿琛岋紝涓斾篃涓嶄細淇敼褰撳墠婊氬姩浣嶇疆
		// 濡傛灉褰撳墠鎵€鏈夌紦鍐茶閮藉皢琚垹闄や笖娌℃湁鏂扮儹琛屽姞鍏ワ紝鍒欏垹闄ゆ墍鏈夌紦鍐茶锛屼笖涔熶笉浼氫慨鏀瑰綋鍓嶆粴鍔ㄤ綅缃?
		// 濡傛灉褰撳墠鎵€鏈夌紦鍐茶閮藉皢琚垹闄や笖鏈夋柊鐑鍔犲叆锛屽垯鍒犻櫎鎵€鏈夌紦鍐茶骞跺姞鍏ユ柊鐑浣滀负缂撳啿琛岋紝鐒跺悗淇敼褰撳墠婊氬姩浣嶇疆

		this.currentTime = time;

		if (!this.initialLayoutFinished && !isSeek) return;

		const removedHotIds = new Set<number>();
		const removedIds = new Set<number>();
		const addedIds = new Set<number>();

		// 鍏堟绱㈠綋鍓嶅凡缁忚秴鍑烘椂闂磋寖鍥寸殑缂撳啿琛岋紝鍒楀叆寰呭垹闄ら泦鍐?
		for (const lastHotId of this.hotLines) {
			const line = this.processedLines[lastHotId];
			if (line) {
				if (line.isBG) continue;
				const nextLine = this.processedLines[lastHotId + 1];
				if (nextLine?.isBG) {
					const nextMainLine = this.processedLines[lastHotId + 2];
					const startTime = Math.min(line.startTime, nextLine?.startTime);
					const endTime = Math.min(
						Math.max(line.endTime, nextMainLine?.startTime ?? Number.MAX_VALUE),
						Math.max(line.endTime, nextLine?.endTime),
					);
					if (startTime > time || endTime <= time) {
						this.hotLines.delete(lastHotId);
						removedHotIds.add(lastHotId);
						this.hotLines.delete(lastHotId + 1);
						removedHotIds.add(lastHotId + 1);
						if (isSeek) {
							this.currentLyricLineObjects[lastHotId]?.disable();
							this.currentLyricLineObjects[lastHotId + 1]?.disable();
						}
					}
				} else if (line.startTime > time || line.endTime <= time) {
					this.hotLines.delete(lastHotId);
					removedHotIds.add(lastHotId);
					if (isSeek) this.currentLyricLineObjects[lastHotId]?.disable();
				}
			} else {
				this.hotLines.delete(lastHotId);
				removedHotIds.add(lastHotId);
				if (isSeek) this.currentLyricLineObjects[lastHotId]?.disable();
			}
		}
		this.currentLyricLineObjects.forEach((lineObj, id, arr) => {
			const line = lineObj.getLine();

			if (!line.isBG && line.startTime <= time && line.endTime > time) {
				if (isSeek) {
					lineObj.enable(time, this.isPlaying);
				}

				if (!this.hotLines.has(id)) {
					this.hotLines.add(id);
					addedIds.add(id);

					if (!isSeek) {
						lineObj.enable();
					}

					if (arr[id + 1]?.getLine()?.isBG) {
						this.hotLines.add(id + 1);
						addedIds.add(id + 1);
						if (isSeek) {
							arr[id + 1].enable(time, this.isPlaying);
						} else {
							arr[id + 1].enable();
						}
					}
				}
			}
		});
		for (const v of this.bufferedLines) {
			if (!this.hotLines.has(v)) {
				removedIds.add(v);
				if (isSeek) this.currentLyricLineObjects[v]?.disable();
			}
		}
		if (isSeek) {
			this.bufferedLines.clear();
			for (const v of this.hotLines) {
				this.bufferedLines.add(v);
			}

			if (this.bufferedLines.size > 0) {
				this.scrollToIndex = Math.min(...this.bufferedLines);
			} else {
				const foundIndex = this.processedLines.findIndex(
					(line) => line.startTime >= time,
				);

				this.scrollToIndex =
					foundIndex === -1 ? this.processedLines.length : foundIndex;
			}

			this.resetScroll();
			this.calcLayout();
		} else if (removedIds.size > 0 || addedIds.size > 0) {
			if (removedIds.size === 0 && addedIds.size > 0) {
				for (const v of addedIds) {
					this.bufferedLines.add(v);
					this.currentLyricLineObjects[v]?.enable();
				}
				this.scrollToIndex = Math.min(...this.bufferedLines);
				this.calcLayout();
			} else if (addedIds.size === 0 && removedIds.size > 0) {
				if (eqSet(removedIds, this.bufferedLines)) {
					for (const v of this.bufferedLines) {
						if (!this.hotLines.has(v)) {
							this.bufferedLines.delete(v);
							this.currentLyricLineObjects[v]?.disable();
						}
					}
					this.calcLayout();
				}
			} else {
				for (const v of addedIds) {
					this.bufferedLines.add(v);
					this.currentLyricLineObjects[v]?.enable();
				}
				for (const v of removedIds) {
					this.bufferedLines.delete(v);
					this.currentLyricLineObjects[v]?.disable();
				}
				if (this.bufferedLines.size > 0)
					this.scrollToIndex = Math.min(...this.bufferedLines);
				this.calcLayout();
			}
		}
		this.lastCurrentTime = time;
	}

	/**
	 * 閲嶆柊甯冨眬瀹氫綅姝岃瘝琛岀殑浣嶇疆锛岃皟鐢ㄥ畬鎴愬悗鍐嶉€愬抚璋冪敤 `update`
	 * 鍑芥暟鍗冲彲璁╂瓕璇嶉€氳繃鍔ㄧ敾绉诲姩鍒扮洰鏍囦綅缃€?
	 *
	 * 鍑芥暟鏈変竴涓?`force` 鍙傛暟锛岀敤浜庢寚瀹氭槸鍚﹀己鍒朵慨鏀瑰竷灞€锛屼篃灏辨槸涓嶇粡杩囧姩鐢荤洿鎺ヨ皟鏁村厓绱犱綅缃拰澶у皬銆?
	 *
	 * 姝ゅ嚱鏁拌繕鏈変竴涓?`reflow` 鍙傛暟锛岀敤浜庢寚瀹氭槸鍚﹂渶瑕侀噸鏂拌绠楀竷灞€
	 *
	 * 鍥犱负璁＄畻甯冨眬蹇呭畾浼氬鑷存祻瑙堝櫒閲嶆帓甯冨眬锛屾墍浠ヤ細澶у箙搴﹀奖鍝嶆祦鐣呭害鍜屾€ц兘锛屾晠璇峰彧鍦ㄤ互涓嬫儏鍐典笅灏嗗叾鈥嬭缃负 true锛?
	 *
	 * 1. 姝岃瘝椤甸潰澶у皬鍙戠敓鏀瑰彉鏃讹紙杩欎釜缁勪欢浼氳嚜琛屽鐞嗭級
	 * 2. 鍔犺浇浜嗘柊鐨勬瓕璇嶆椂锛堜笉璁哄墠鍚庢瓕璇嶆槸鍚﹀畬鍏ㄤ竴鏍凤級
	 * 3. 鐢ㄦ埛鑷璺宠浆浜嗘瓕鏇叉挱鏀句綅缃紙涓嶈璺濈杩滆繎锛?
	 *
	 * @param sync 鏄惁鍚屾鎵ц锛岄€氬父鐢ㄤ簬鍒濆鍖栨垨 Resize 鏃剁珛鍗冲竷灞€
	 * @param force 鏄惁缁曡繃寮圭哀鏁堟灉寮哄埗鏇存柊浣嶇疆
	 */
	async calcLayout(sync = false, force = false) {
		const interlude = this.getCurrentInterlude();
		let curPos = -this.scrollOffset;
		const targetAlignIndex = this.scrollToIndex;
		let isNextDuet = false;
		if (interlude) {
			isNextDuet = interlude[3];
		} else {
			this.interludeDots.setInterlude(undefined);
		}

		const fontSize = this.baseFontSize || 24;
		const dotMargin = fontSize * 0.4;
		const totalInterludeHeight = this.interludeDotsSize[1] + dotMargin * 2;

		if (interlude) {
			if (interlude[2] !== -1) {
				curPos -= totalInterludeHeight;
			}
		}
		// 閬垮厤涓€寮€濮嬪氨璁╂墍鏈夋瓕璇嶈鎸ゅ湪涓€璧?
		const LINE_HEIGHT_FALLBACK = this.size[1] / 5;
		const scrollOffset = this.currentLyricLineObjects
			.slice(0, targetAlignIndex)
			.reduce(
				(acc, el) =>
					acc +
					(el.getLine().isBG && this.isPlaying
						? 0
						: (this.lyricLinesSize.get(el)?.[1] ?? LINE_HEIGHT_FALLBACK)),
				0,
			);
		this.scrollBoundary[0] = -scrollOffset;
		curPos -= scrollOffset;
		curPos += this.size[1] * this.alignPosition;
		const curLine = this.currentLyricLineObjects[targetAlignIndex];
		this.targetAlignIndex = targetAlignIndex;
		if (curLine) {
			const lineHeight =
				this.lyricLinesSize.get(curLine)?.[1] ?? LINE_HEIGHT_FALLBACK;
			switch (this.alignAnchor) {
				case "bottom":
					curPos -= lineHeight;
					break;
				case "center":
					curPos -= lineHeight / 2;
					break;
				case "top":
					break;
			}
		}
		const latestIndex = Math.max(...this.bufferedLines);
		let delay = 0;
		let baseDelay = sync ? 0 : 0.05;
		let setDots = false;
		this.currentLyricLineObjects.forEach((lineObj, i) => {
			const hasBuffered = this.bufferedLines.has(i);
			const isActive =
				hasBuffered || (i >= this.scrollToIndex && i < latestIndex);
			const line = lineObj.getLine();

			const shouldShowDots = interlude && i === interlude[2] + 1;

			if (!setDots && shouldShowDots) {
				setDots = true;

				curPos += dotMargin;

				let targetX = 0;
				if (interlude && isNextDuet) {
					targetX = this.size[0] - this.interludeDotsSize[0];
				}

				this.interludeDots.setTransform(targetX, curPos);

				if (interlude) {
					this.interludeDots.setInterlude([interlude[0], interlude[1]]);
				}
				curPos += this.interludeDotsSize[1];
				curPos += dotMargin;
			}

			let targetOpacity: number;

			if (this.hidePassedLines) {
				if (
					i < (interlude ? interlude[2] + 1 : this.scrollToIndex) &&
					this.isPlaying
				) {
					// 涓轰簡閬垮厤娴忚鍣ㄤ紭鍖栵紝杩欓噷浣跨敤浜嗕竴涓瀬灏忎絾涓嶄负闆剁殑鍊硷紙鍑犱箮涓嶅彲瑙侊級
					targetOpacity = 0.00001;
				} else if (hasBuffered) {
					targetOpacity = 0.85;
				} else {
					targetOpacity = this.isNonDynamic ? 0.2 : 1;
				}
			} else {
				if (hasBuffered) {
					targetOpacity = 0.85;
				} else {
					targetOpacity = this.isNonDynamic ? 0.2 : 1;
				}
			}

			let blurLevel = 0;

			if (this.enableBlur && !isActive) {
				const lineDistance =
					i < this.scrollToIndex
						? Math.abs(this.scrollToIndex - i)
						: Math.abs(i - Math.max(this.scrollToIndex, latestIndex));
				const blurStartDistance = window.innerWidth <= 1024 ? 1 : 2;
				const effectiveBlurDistance = Math.max(0, lineDistance - blurStartDistance);

				if (effectiveBlurDistance > 0) {
					blurLevel = 0.65 + effectiveBlurDistance * 0.85;
				}
			}

			const SCALE_ASPECT = this.enableScale ? 97 : 100;

			let targetScale = 100;

			if (!isActive && this.isPlaying) {
				if (line.isBG) {
					targetScale = 75;
				} else {
					targetScale = SCALE_ASPECT;
				}
			}

			if (this.isUserScrolling) {
				blurLevel = 0;
			}

			const renderMode = isActive
				? LyricLineRenderMode.GRADIENT
				: LyricLineRenderMode.SOLID;

			lineObj.setTransform(
				curPos,
				targetScale,
				targetOpacity,
				window.innerWidth <= 1024 ? blurLevel * 0.8 : blurLevel,
				force,
				delay,
				renderMode,
			);

			if (line.isBG && (isActive || !this.isPlaying)) {
				curPos += this.lyricLinesSize.get(lineObj)?.[1] ?? LINE_HEIGHT_FALLBACK;
			} else if (!line.isBG) {
				curPos += this.lyricLinesSize.get(lineObj)?.[1] ?? LINE_HEIGHT_FALLBACK;
			}
			if (curPos >= 0 && !this.isSeeking) {
				if (!line.isBG) delay += baseDelay;

				if (i >= this.scrollToIndex) baseDelay /= 1.05;
			}
		});
		this.scrollBoundary[1] = curPos + this.scrollOffset - this.size[1] / 2;
		// console.groupEnd();
		this.bottomLine.setTransform(0, curPos, force, delay);
	}

	/**
	 * 璁剧疆鎵€鏈夋瓕璇嶈鍦ㄦí鍧愭爣涓婄殑寮圭哀灞炴€э紝鍖呮嫭閲嶉噺銆佸脊鍔涘拰闃诲姏銆?
	 *
	 * @param params 闇€瑕佽缃殑寮圭哀灞炴€э紝鎻愪緵鐨勫睘鎬у皢浼氳鐩栧師鏉ョ殑灞炴€э紝鏈彁渚涚殑灞炴€у皢浼氫繚鎸佸師鏍?
	 * @deprecated 鑰冭檻鍒版í鍚戝脊绨ф晥鏋滃苟涓嶅父瑙侊紝鎵€浠ヨ繖涓嚱鏁板皢浼氬湪鏈潵鐨勭増鏈腑绉婚櫎
	 */
	setLinePosXSpringParams(_params: Partial<SpringParams> = {}) {}
	/**
	 * 璁剧疆鎵€鏈夋瓕璇嶈鍦ㄢ€嬬旱鍧愭爣涓婄殑寮圭哀灞炴€э紝鍖呮嫭閲嶉噺銆佸脊鍔涘拰闃诲姏銆?
	 *
	 * @param params 闇€瑕佽缃殑寮圭哀灞炴€э紝鎻愪緵鐨勫睘鎬у皢浼氳鐩栧師鏉ョ殑灞炴€э紝鏈彁渚涚殑灞炴€у皢浼氫繚鎸佸師鏍?
	 */
	setLinePosYSpringParams(params: Partial<SpringParams> = {}) {
		this.posYSpringParams = {
			...this.posYSpringParams,
			...params,
		};
		this.bottomLine.lineTransforms.posY.updateParams(this.posYSpringParams);
		for (const line of this.currentLyricLineObjects) {
			line.lineTransforms.posY.updateParams(this.posYSpringParams);
		}
	}
	/**
	 * 璁剧疆鎵€鏈夋瓕璇嶈鍦ㄢ€嬬缉鏀惧ぇ灏忎笂鐨勫脊绨у睘鎬э紝鍖呮嫭閲嶉噺銆佸脊鍔涘拰闃诲姏銆?
	 *
	 * @param params 闇€瑕佽缃殑寮圭哀灞炴€э紝鎻愪緵鐨勫睘鎬у皢浼氳鐩栧師鏉ョ殑灞炴€э紝鏈彁渚涚殑灞炴€у皢浼氫繚鎸佸師鏍?
	 */
	setLineScaleSpringParams(params: Partial<SpringParams> = {}) {
		this.scaleSpringParams = {
			...this.scaleSpringParams,
			...params,
		};
		this.scaleForBGSpringParams = {
			...this.scaleForBGSpringParams,
			...params,
		};
		for (const lineObj of this.currentLyricLineObjects) {
			if (lineObj.getLine().isBG) {
				lineObj.lineTransforms.scale.updateParams(this.scaleForBGSpringParams);
			} else {
				lineObj.lineTransforms.scale.updateParams(this.scaleSpringParams);
			}
		}
	}
	protected isPlaying = true;
	/**
	 * 鏆傚仠閮ㄥ垎鏁堟灉婕斿嚭锛岀洰鍓嶄細鏆傚仠鎾斁闂村鐐圭殑鍔ㄧ敾锛屼笖灏嗚儗鏅瓕璇嶆樉绀哄嚭鏉?
	 */
	pause() {
		this.interludeDots.pause();
		if (this.isPlaying) {
			this.isPlaying = false;
			this.calcLayout();
		}
	}
	/**
	 * 鎭㈠閮ㄥ垎鏁堟灉婕斿嚭锛岀洰鍓嶄細鎭㈠鎾斁闂村鐐圭殑鍔ㄧ敾
	 */
	resume() {
		this.interludeDots.resume();
		if (!this.isPlaying) {
			this.isPlaying = true;
			this.calcLayout();
		}
	}
	/**
	 * 鏇存柊鍔ㄧ敾锛岃繖涓嚱鏁板簲璇ヨ閫愬抚璋冪敤鎴栬€呭湪浠ヤ笅鎯呭喌涓嬭皟鐢ㄤ竴娆★細
	 *
	 * 1. 鍒氬垰璋冪敤瀹岃缃瓕璇嶅嚱鏁扮殑鏃跺€?
	 * @param delta 璺濈涓婁竴娆¤璋冪敤鍒扮幇鍦ㄧ殑鏃堕暱锛屽崟浣嶄负姣锛堝彲涓烘诞鐐规暟锛?
	 */

	update(delta = 0) {
		this.bottomLine.update(delta / 1000);
		this.interludeDots.update(delta / 1000);
	}

	protected onResize() {}

	/**
	 * 鑾峰彇涓€涓壒娈婄殑搴曟爮鍏冪礌锛岄粯璁ゆ槸绌虹櫧鐨勶紝鍙互寰€鍐呴儴娣诲姞浠绘剰鍏冪礌
	 *
	 * 杩欎釜鍏冪礌濮嬬粓鍦ㄦ瓕璇嶇殑搴曢儴锛屽彲浠ョ敤浜庢樉绀烘瓕鏇插垱浣滆€呯瓑淇℃伅
	 *
	 * 浣嗘槸璇峰嬁鍒犻櫎璇ュ厓绱狅紝鍙兘鍦ㄥ唴閮ㄥ瓨鏀惧厓绱?
	 *
	 * @returns 涓€涓厓绱狅紝鍙互寰€鍐呴儴娣诲姞浠绘剰鍏冪礌
	 */
	getBottomLineElement(): HTMLElement {
		return this.bottomLine.getElement();
	}
	/**
	 * 閲嶇疆鐢ㄦ埛婊氬姩鐘舵€?
	 *
	 * 璇峰湪鐢ㄦ埛瀹屾垚婊氬姩鐐瑰嚮璺宠浆姝岃瘝鏃惰皟鐢ㄦ湰浜嬩欢鍐嶈皟鐢?`calcLayout` 浠ユ纭粴鍔ㄥ埌鐩爣浣嶇疆
	 */
	resetScroll() {
		this.isScrolled = false;
		this.scrollOffset = 0;
		clearTimeout(this.scrolledHandler);
		this.scrolledHandler = 0;
	}
	/**
	 * 鑾峰彇褰撳墠姝岃瘝鏁扮粍
	 *
	 * 涓€鑸拰鏈€鍚庤皟鐢?`setLyricLines` 缁欎簣鐨勫弬鏁颁竴鏍?
	 * @returns 褰撳墠姝岃瘝鏁扮粍
	 */
	getLyricLines() {
		return this.currentLyricLines;
	}
	/**
	 * 鑾峰彇褰撳墠姝岃瘝鐨勬挱鏀句綅缃?
	 *
	 * 涓€鑸拰鏈€鍚庤皟鐢?`setCurrentTime` 缁欎簣鐨勫弬鏁颁竴鏍?
	 * @returns 褰撳墠鎾斁浣嶇疆
	 */
	getCurrentTime() {
		return this.currentTime;
	}

	getElement(): HTMLElement {
		return this.element;
	}
	dispose(): void {
		if (this.resizeObserverFrame) {
			cancelAnimationFrame(this.resizeObserverFrame);
			this.resizeObserverFrame = 0;
		}
		this.resizeObserver.disconnect();
		this.element.remove();
		window.removeEventListener("pageshow", this.onPageShow);
		window.removeEventListener("pagehide", this.onPageHide);
	}
}

/**
 * 鎵€鏈夋爣鍑嗘瓕璇嶈鐨勫熀绫?
 * @internal
 */
export abstract class LyricLineBase extends EventTarget implements Disposable {
	protected top = 0;
	protected scale = 1;
	protected blur = 0;
	protected opacity = 1;
	protected delay = 0;
	readonly lineTransforms = {
		posY: new Spring(0),
		scale: new Spring(100),
	};
	abstract getLine(): LyricLine;
	abstract enable(time?: number, shouldPlay?: boolean): void;
	abstract disable(): void;
	abstract resume(): void;
	abstract pause(): void;
	onLineSizeChange(_size: [number, number]): void {}
	setTransform(
		top: number = this.top,
		scale: number = this.scale,
		opacity: number = this.opacity,
		blur: number = this.blur,
		_force = false,
		delay = 0,
		_mode = LyricLineRenderMode.SOLID,
	) {
		this.top = top;
		this.scale = scale;
		this.opacity = opacity;
		this.blur = blur;
		this.delay = delay;
	}

	rebuildElement() {}

	/**
	 * 鍒ゅ畾姝岃瘝鏄惁鍙互搴旂敤寮鸿皟杈夊厜鏁堟灉
	 *
	 * 鏋滃瓙鍦ㄥ杈夊厜鏁堟灉鐨勮В閲婃槸涓€绉嶅己璋冿紙emphasized锛夋晥鏋?
	 *
	 * 鏉′欢鏄竴涓崟璇嶆椂闀垮ぇ浜庣瓑浜?1s 涓旈暱搴﹀皬浜庣瓑浜?7
	 *
	 * @param word 鍗曡瘝
	 * @returns 鏄惁鍙互搴旂敤寮鸿皟杈夊厜鏁堟灉
	 */
	static shouldEmphasize(word: LyricWord): boolean {
		if (isCJK(word.word)) return word.endTime - word.startTime >= 1000;

		return (
			word.endTime - word.startTime >= 1000 &&
			word.word.trim().length <= 7 &&
			word.word.trim().length > 1
		);
	}
	abstract update(delta?: number): void;
	dispose() {}
}





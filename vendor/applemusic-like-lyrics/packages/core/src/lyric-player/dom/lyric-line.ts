import bezier from "bezier-easing";
import type { LyricLine, LyricWord } from "../../interfaces.ts";
import styles from "../../styles/lyric-player.module.css";
import { isCJK } from "../../utils/is-cjk.ts";
import { chunkAndSplitLyricWords } from "../../utils/lyric-split-words.ts";
import {
	createMatrix4,
	matrix4ToCSS,
	scaleMatrix4,
} from "../../utils/matrix.ts";
import { LyricLineBase } from "../base.ts";
import { LyricLineRenderMode } from "../enums.ts";
import type { DomLyricPlayer } from ".";

interface RealWord extends LyricWord {
	mainElement: HTMLSpanElement;
	subElements: HTMLSpanElement[];
	elementAnimations: Animation[];
	maskAnimations: Animation[];
	width: number;
	height: number;
	padding: number;
	shouldEmphasize: boolean;
}

const ANIMATION_FRAME_QUANTITY = 32;

const norNum = (min: number, max: number) => (x: number) =>
	Math.min(1, Math.max(0, (x - min) / (max - min)));
const EMP_EASING_MID = 0.5;
const beginNum = norNum(0, EMP_EASING_MID);
const endNum = norNum(EMP_EASING_MID, 1);

const bezIn = bezier(0.2, 0.4, 0.58, 1.0);
const bezOut = bezier(0.3, 0.0, 0.58, 1.0);

const makeEmpEasing = (mid: number) => {
	return (x: number) => (x < mid ? bezIn(beginNum(x)) : 1 - bezOut(endNum(x)));
};

function generateFadeGradient(
	width: number,
	padding = 0,
	bright = "rgba(0,0,0,var(--bright-mask-alpha, 1.0))",
	dark = "rgba(0,0,0,var(--dark-mask-alpha, 1.0))",
): [string, number] {
	const totalAspect = 2 + width + padding;
	const widthInTotal = width / totalAspect;
	const leftPos = (1 - widthInTotal) / 2;
	return [
		`linear-gradient(to right,${bright} ${leftPos * 100}%,${dark} ${
			(leftPos + widthInTotal) * 100
		}%)`,
		totalAspect,
	];
}

export class RawLyricLineMouseEvent extends MouseEvent {
	constructor(
		public readonly line: LyricLineBase,
		event: MouseEvent,
	) {
		super(event.type, event);
	}
}

type MouseEventMap = {
	[evt in keyof HTMLElementEventMap]: HTMLElementEventMap[evt] extends MouseEvent
		? evt
		: never;
};
type MouseEventTypes = MouseEventMap[keyof MouseEventMap];
type MouseEventListener = (
	this: LyricLineEl,
	ev: RawLyricLineMouseEvent,
) => void;

export class LyricLineEl extends LyricLineBase {
	private element: HTMLElement = document.createElement("div");
	private splittedWords: RealWord[] = [];
	// 鏍囪鏄惁宸茬粡鏋勫缓浜嗚鍐呯殑瀹為檯 DOM锛堝崟璇嶄笌鍔ㄧ敾绛夛級
	private built = false;

	// 鐢?LyricPlayer 鏉ヨ缃?
	lineSize: number[] = [0, 0];

	private renderMode = LyricLineRenderMode.SOLID;

	private currentBrightAlpha = 1.0;
	private currentDarkAlpha = 0.2;

	private targetBrightAlpha = 1.0;
	private targetDarkAlpha = 0.2;

	constructor(
		private lyricPlayer: DomLyricPlayer,
		private lyricLine: LyricLine = {
			words: [],
			translatedLyric: "",
			romanLyric: "",
			startTime: 0,
			endTime: 0,
			isBG: false,
			isDuet: false,
		},
	) {
		super();
		this._prevParentEl = lyricPlayer.getElement();
		lyricPlayer.resizeObserver.observe(this.element);
		this.element.setAttribute("class", styles.lyricLine);
		if (this.lyricLine.isBG) {
			this.element.classList.add(styles.lyricBgLine);
		}
		if (this.lyricLine.isDuet) {
			this.element.classList.add(styles.lyricDuetLine);
		}
		this.lineTransforms.posY.setPosition(window.innerHeight * 2);
		this.element.appendChild(document.createElement("div")); // 姝岃瘝琛?
		this.element.appendChild(document.createElement("div")); // 缈昏瘧琛?
		this.element.appendChild(document.createElement("div")); // 闊宠瘧琛?
		const main = this.element.children[0] as HTMLDivElement;
		const trans = this.element.children[1] as HTMLDivElement;
		const roman = this.element.children[2] as HTMLDivElement;
		main.setAttribute("class", styles.lyricMainLine);
		trans.setAttribute("class", styles.lyricSubLine);
		roman.setAttribute("class", styles.lyricSubLine);
		// 寤惰繜鏋勫缓鍏蜂綋琛屽唴瀹癸紝杩涘叆鍙鍖猴紙鍚?overscan锛夋椂鍐嶆瀯寤?
		this.rebuildStyle();
	}
	private listenersMap = new Map<string, Set<MouseEventListener>>();
	private readonly onMouseEvent = (e: MouseEvent) => {
		const wrapped = new RawLyricLineMouseEvent(this, e);
		for (const listener of this.listenersMap.get(e.type) ?? []) {
			listener.call(this, wrapped);
		}
		if (!this.dispatchEvent(wrapped) || wrapped.defaultPrevented) {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			return false;
		}
	};

	addMouseEventListener(
		type: MouseEventTypes,
		callback: MouseEventListener | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void {
		if (callback) {
			const listeners = this.listenersMap.get(type) ?? new Set();
			if (listeners.size === 0)
				this.element.addEventListener(type, this.onMouseEvent, options);
			listeners.add(callback);
			this.listenersMap.set(type, listeners);
		}
	}

	removeMouseEventListener(
		type: MouseEventTypes,
		callback: MouseEventListener | null,
		options?: boolean | EventListenerOptions | undefined,
	): void {
		if (callback) {
			const listeners = this.listenersMap.get(type);
			if (listeners) {
				listeners.delete(callback);
				if (listeners.size === 0)
					this.element.removeEventListener(type, this.onMouseEvent, options);
			}
		}
	}

	areWordsOnSameLine(word1: RealWord, word2: RealWord) {
		if (word1?.mainElement && word2?.mainElement) {
			const word1el = word1.mainElement;
			const word2el = word2.mainElement;

			const rect1 = word1el.getBoundingClientRect();
			const rect2 = word2el.getBoundingClientRect();

			// 妫€鏌ヤ袱涓崟璇嶇殑椤堕儴璺濈鏄惁鐩哥瓑锛堟垨鑰呭樊鍊煎緢灏忥級
			const topDifference = Math.abs(rect1.top - rect2.top);

			// 濡傛灉椤堕儴璺濈鐩稿樊寰堝皬锛屽彲浠ヨ涓哄畠浠湪鍚屼竴琛屼笂
			return topDifference < 10;
		}

		return true;
	}

	private isEnabled = false;
	async enable(
		maskAnimationTime = this.lyricLine.startTime,
		shouldPlay = true,
	) {
		this.isEnabled = true;
		this.element.classList.add(styles.active);
		const main = this.element.children[0] as HTMLDivElement;

		const relativeTime = Math.max(
			0,
			maskAnimationTime - this.lyricLine.startTime,
		);
		const actualMaskTime =
			maskAnimationTime === this.lyricLine.startTime
				? this.lyricPlayer.getCurrentTime()
				: maskAnimationTime;

		const maskRelativeTime = Math.max(
			0,
			actualMaskTime - this.lyricLine.startTime,
		);

		for (const word of this.splittedWords) {
			for (const a of word.elementAnimations) {
				a.currentTime = relativeTime;
				a.playbackRate = 1;

				const timing = a.effect?.getComputedTiming();
				const duration = (timing?.duration as number) || 0;
				const delay = (timing?.delay as number) || 0;
				const endTime = delay + duration;

				if (shouldPlay && relativeTime < endTime) {
					a.play();
				} else {
					a.pause();
				}
			}

			for (const a of word.maskAnimations) {
				const t = Math.min(this.totalDuration, maskRelativeTime);
				a.currentTime = t;
				a.playbackRate = 1;

				const timing = a.effect?.getComputedTiming();
				const duration = (timing?.duration as number) || 0;
				const delay = (timing?.delay as number) || 0;
				const endTime = delay + duration;

				if (shouldPlay && t < endTime) {
					a.play();
				} else {
					a.pause();
				}
			}
		}
		main.classList.add(styles.active);
	}

	disable() {
		this.isEnabled = false;
		this.element.classList.remove(styles.active);
		this.renderMode = LyricLineRenderMode.SOLID;

		const main = this.element.children[0] as HTMLDivElement;

		for (const word of this.splittedWords) {
			for (const a of word.elementAnimations) {
				if (
					a.id === "float-word" ||
					a.id.includes("emphasize-word-float-only")
				) {
					a.playbackRate = -1;
					a.play();
				}
			}

			for (const a of word.maskAnimations) {
				a.pause();
			}
		}
		main.classList.remove(styles.active);
	}

	private lastWord?: RealWord;

	async resume() {
		if (!this.isEnabled) return;
		for (const word of this.splittedWords) {
			for (const a of word.elementAnimations) {
				if (
					!this.lastWord ||
					this.splittedWords.indexOf(this.lastWord) <
						this.splittedWords.indexOf(word)
				) {
					const timing = a.effect?.getComputedTiming();
					const duration = (timing?.duration as number) || 0;
					const delay = (timing?.delay as number) || 0;
					const endTime = delay + duration;
					const currentTime = (a.currentTime as number) || 0;

					if (a.playState !== "finished" && currentTime < endTime) {
						a.play();
					}
				}
			}

			for (const a of word.maskAnimations) {
				if (
					!this.lastWord ||
					this.splittedWords.indexOf(this.lastWord) <
						this.splittedWords.indexOf(word)
				) {
					const timing = a.effect?.getComputedTiming();
					const duration = (timing?.duration as number) || 0;
					const delay = (timing?.delay as number) || 0;
					const endTime = delay + duration;

					const currentTime = (a.currentTime as number) || 0;

					if (a.playState !== "finished" && currentTime < endTime) {
						a.play();
					}
				}
			}
		}
	}

	async pause() {
		if (!this.isEnabled) return;
		for (const word of this.splittedWords) {
			for (const a of word.elementAnimations) {
				a.pause();
			}
			for (const a of word.maskAnimations) {
				a.pause();
			}
		}
	}
	setMaskAnimationState(maskAnimationTime = 0) {
		const t = maskAnimationTime - this.lyricLine.startTime;
		for (const word of this.splittedWords) {
			for (const a of word.maskAnimations) {
				a.currentTime = Math.min(this.totalDuration, Math.max(0, t));
				a.playbackRate = 1;
				if (t >= 0 && t < this.totalDuration) a.play();
				else a.pause();
			}
		}
	}

	getLine() {
		return this.lyricLine;
	}
	// private _hide = true;
	private _prevParentEl: HTMLElement;
	private lastStyle = "";
	show() {
		// this._hide = false;
		if (!this.element.parentElement) {
			this._prevParentEl.appendChild(this.element);
			this.lyricPlayer.resizeObserver.observe(this.element);
		}
		if (!this.built) {
			this.rebuildElement();
			this.built = true;
			this.updateMaskImageSync();
		}
		this.rebuildStyle();
	}
	hide() {
		// this._hide = true;
		if (this.element.parentElement) {
			this._prevParentEl.removeChild(this.element);
			this.lyricPlayer.resizeObserver.unobserve(this.element);
		}
		if (this.built) {
			this.disposeElements();
			this.built = false;
		}
	}
	private rebuildStyle() {
		let style = "";
		// if (this.lyricPlayer.getEnableSpring()) {
		style += `transform:translateY(${this.lineTransforms.posY
			.getCurrentPosition()
			.toFixed(
				1,
			)}px) scale(${(this.lineTransforms.scale.getCurrentPosition() / 100).toFixed(4)});`;
		if (!this.lyricPlayer.getEnableSpring() && this.isInSight) {
			style += `transition-delay:${this.delay}ms;`;
		}
		style += `filter:blur(${Math.min(5, this.blur)}px);`;
		if (style !== this.lastStyle) {
			this.lastStyle = style;
			this.element.setAttribute("style", style);
		}
	}

	override rebuildElement() {
		this.disposeElements();
		const main = this.element.children[0] as HTMLDivElement;
		const trans = this.element.children[1] as HTMLDivElement;
		const roman = this.element.children[2] as HTMLDivElement;
		// 闈炲姩鎬佹瓕璇嶏紝鐩存帴娓叉煋鏁磋涓庡壇琛?
		if (this.lyricPlayer._getIsNonDynamic()) {
			main.innerText = this.lyricLine.words
				.map((w) => this.lyricPlayer.processObsceneWord(w))
				.join("");
			this.setSubLinesText(trans, roman);
			return;
		}

		const chunkedWords = chunkAndSplitLyricWords(this.lyricLine.words);
		const hasRubyLine = this.lyricLine.words.some(
			(word) => (word.ruby?.length ?? 0) > 0,
		);
		const hasRomanLine = this.lyricLine.words.some(
			(word) => (word.romanWord?.trim().length ?? 0) > 0,
		);
		main.innerHTML = "";

		for (const chunk of chunkedWords) {
			this.buildWord(chunk, main, hasRubyLine, hasRomanLine);
		}

		this.setSubLinesText(trans, roman);
	}

	/** 璁剧疆缈昏瘧涓庨煶璇戣鏂囨湰 */
	private setSubLinesText(trans: HTMLDivElement, roman: HTMLDivElement) {
		trans.innerText = this.lyricLine.translatedLyric;
		roman.innerText = this.lyricLine.romanLyric;
	}

	private getRubyCharCount(word: LyricWord) {
		return (word.ruby ?? []).reduce(
			(total, ruby) => total + ruby.word.length,
			0,
		);
	}

	private getRubySegments(word: LyricWord) {
		return (word.ruby ?? []).filter(
			(ruby) => (ruby?.word?.trim().length ?? 0) > 0,
		);
	}

	private createWord(
		word: LyricWord,
		shouldEmphasize: boolean,
		hasRubyLine: boolean,
		hasRomanLine: boolean,
	): RealWord {
		const mainWordEl = document.createElement("span");
		const subElements: HTMLSpanElement[] = [];
		const romanWord = word.romanWord?.trim() ?? "";
		const wordContainer = hasRubyLine
			? document.createElement("div")
			: mainWordEl;

		if (hasRubyLine) {
			const rubyWordEl = document.createElement("div");
			const rubySegments = this.getRubySegments(word);
			for (const ruby of rubySegments) {
				const rubyPartEl = document.createElement("span");
				rubyPartEl.innerText = ruby.word;
				rubyPartEl.dataset.startTime = String(ruby.startTime);
				rubyPartEl.dataset.endTime = String(ruby.endTime);
				rubyWordEl.appendChild(rubyPartEl);
			}
			rubyWordEl.classList.add(styles.rubyWord);
			mainWordEl.classList.add(styles.wordWithRuby);
			wordContainer.classList.add(styles.wordBody);
			mainWordEl.appendChild(rubyWordEl);
			mainWordEl.appendChild(wordContainer);
		}
		if (hasRomanLine && !hasRubyLine) {
			mainWordEl.classList.add(styles.wordWithRoman);
		}

		const displayWord = this.lyricPlayer.processObsceneWord(word);

		if (shouldEmphasize) {
			mainWordEl.classList.add(styles.emphasize);
			for (const char of displayWord.trim()) {
				const charEl = document.createElement("span");
				charEl.innerText = char;
				subElements.push(charEl);
				wordContainer.appendChild(charEl);
			}
		} else {
			if (hasRomanLine) {
				const wordEl = document.createElement("div");
				wordEl.innerText = displayWord.trim();
				wordContainer.appendChild(wordEl);
			} else if (romanWord.length === 0) {
				wordContainer.innerText = displayWord.trim();
			}
		}

		if (hasRomanLine) {
			const romanWordEl = document.createElement("div");
			romanWordEl.innerText = romanWord.length > 0 ? romanWord : "\u00A0";
			romanWordEl.classList.add(styles.romanWord);
			wordContainer.prepend(romanWordEl);
		}

		const realWord: RealWord = {
			...word,
			mainElement: mainWordEl,
			subElements: subElements,
			elementAnimations: [this.initFloatAnimation(word, mainWordEl)],
			maskAnimations: [],
			width: 0,
			height: 0,
			padding: 0,
			shouldEmphasize: shouldEmphasize,
		};

		return realWord;
	}

	private buildWord(
		input: LyricWord | LyricWord[],
		main: HTMLDivElement,
		hasRubyLine: boolean,
		hasRomanLine: boolean,
	) {
		const chunk = Array.isArray(input) ? input : [input];
		if (chunk.length === 0) return;

		const isPureSpace = chunk.every((w) => !w.word.trim());
		if (isPureSpace) {
			const textContent = chunk.map((w) => w.word).join("");
			main.appendChild(document.createTextNode(textContent));
			return;
		}

		const merged = chunk.reduce(
			(a, b) => {
				a.endTime = Math.max(a.endTime, b.endTime);
				a.startTime = Math.min(a.startTime, b.startTime);
				a.word += b.word;
				return a;
			},
			{
				word: "",
				romanWord: "",
				startTime: Number.POSITIVE_INFINITY,
				endTime: Number.NEGATIVE_INFINITY,
				wordType: "normal",
				obscene: false,
			} as LyricWord,
		);

		let emp = chunk.some((word) => LyricLineBase.shouldEmphasize(word));
		if (!isCJK(merged.word)) {
			emp = emp || LyricLineBase.shouldEmphasize(merged);
		}

		const wrapperWordEl = document.createElement("span");
		wrapperWordEl.classList.add(styles.emphasizeWrapper);

		const characterElements: HTMLElement[] = [];

		for (const word of chunk) {
			if (!word.word.trim()) {
				wrapperWordEl.appendChild(document.createTextNode(word.word));
				continue;
			}

			const realWord = this.createWord(word, emp, hasRubyLine, hasRomanLine);

			if (emp) {
				characterElements.push(...realWord.subElements);
			}

			this.splittedWords.push(realWord);
			wrapperWordEl.appendChild(realWord.mainElement);
		}

		if (emp && this.splittedWords.length > 0) {
			const lastWordOfChunk = this.splittedWords[this.splittedWords.length - 1];
			const rubyCharCount = chunk.reduce(
				(total, word) => total + this.getRubyCharCount(word),
				0,
			);

			lastWordOfChunk.elementAnimations.push(
				...this.initEmphasizeAnimation(
					merged,
					characterElements,
					merged.endTime - merged.startTime,
					merged.startTime - this.lyricLine.startTime,
					rubyCharCount,
				),
			);
		}

		main.appendChild(wrapperWordEl);
	}

	private initFloatAnimation(word: LyricWord, wordEl: HTMLSpanElement) {
		const delay = word.startTime - this.lyricLine.startTime;
		const duration = Math.max(1000, word.endTime - word.startTime);
		let up = 0.05;
		if (this.lyricLine.isBG) {
			up *= 2;
		}
		const a = wordEl.animate(
			[
				{
					transform: "translateY(0px)",
				},
				{
					transform: `translateY(${-up}em)`,
				},
			],
			{
				duration: Number.isFinite(duration) ? duration : 0,
				delay: Number.isFinite(delay) ? delay : 0,
				id: "float-word",
				composite: "add",
				fill: "both",
				easing: "ease-out",
			},
		);
		a.pause();
		return a;
	}
	// 鎸夌収鍘?Apple Music 鍙傝€冿紝寮鸿皟鏁堟灉鍙簲鐢ㄧ缉鏀俱€佽交寰乏鍙充綅绉诲拰杈夊厜鏁堟灉锛屽師涓昏鐨勬偓娴綅绉绘晥鏋滀笉鍙?
	// 涓轰簡閬垮厤浜х敓閿娇鎶栧姩鎰燂紝浣跨敤 matrix3d 鏉ュ疄鐜扮缉鏀惧拰浣嶇Щ
	private initEmphasizeAnimation(
		word: LyricWord,
		characterElements: HTMLElement[],
		duration: number,
		delay: number,
		rubyCharCount: number,
	): Animation[] {
		const de = Math.max(0, delay);
		let du = Math.max(1000, duration);
		const anchorCharCount =
			rubyCharCount > 0 ? rubyCharCount : Math.max(1, characterElements.length);

		let result: Animation[] = [];

		let amount = du / 2000;
		amount = amount > 1 ? Math.sqrt(amount) : amount ** 3;
		let blur = du / 3000;
		blur = blur > 1 ? Math.sqrt(blur) : blur ** 3;
		amount *= 0.6;
		blur *= 0.5;
		if (
			this.lyricLine.words.length > 0 &&
			word.word.includes(
				this.lyricLine.words[this.lyricLine.words.length - 1].word,
			)
		) {
			amount *= 1.6;
			blur *= 1.5;
			du *= 1.2;
		}
		amount = Math.min(1.2, amount);
		blur = Math.min(0.8, blur);

		const animateDu = Number.isFinite(du) ? du : 0;
		const empEasing = makeEmpEasing(EMP_EASING_MID);

		result = characterElements.flatMap((el, i, arr) => {
			const wordDe = de + (du / 2.5 / anchorCharCount) * i;
			const result: Animation[] = [];

			const frames: Keyframe[] = new Array(ANIMATION_FRAME_QUANTITY)
				.fill(0)
				.map((_, j) => {
					const x = (j + 1) / ANIMATION_FRAME_QUANTITY;
					const transX = empEasing(x);
					const glowLevel = empEasing(x) * blur;

					const mat = scaleMatrix4(createMatrix4(), 1 + transX * 0.1 * amount);
					const offsetX = -transX * 0.03 * amount * (arr.length / 2 - i);
					const offsetY = -transX * 0.025 * amount;

					return {
						offset: x,
						transform: `${matrix4ToCSS(
							mat,
							4,
						)} translate(${offsetX}em, ${offsetY}em)`,
						textShadow: `0 0 ${Math.min(
							0.3,
							blur * 0.3,
						)}em rgba(255, 255, 255, ${glowLevel})`,
					};
				});

			const glow = el.animate(frames, {
				duration: animateDu,
				delay: Number.isFinite(wordDe) ? wordDe : 0,
				id: `emphasize-word-${el.innerText}-${i}`,
				iterations: 1,
				composite: "replace",
				fill: "both",
			});
			glow.onfinish = () => {
				glow.pause();
			};
			glow.pause();
			result.push(glow);

			const floatFrame: Keyframe[] = new Array(ANIMATION_FRAME_QUANTITY)
				.fill(0)
				.map((_, j) => {
					const x = (j + 1) / ANIMATION_FRAME_QUANTITY;
					let y = Math.sin(x * Math.PI);
					// y = x < 0.5 ? y : Math.max(y, 1.0);
					if (this.lyricLine.isBG) {
						y *= 2;
					}

					return {
						offset: x,
						transform: `translateY(${-y * 0.05}em)`,
					};
				});
			const float = el.animate(floatFrame, {
				duration: animateDu * 1.4,
				delay: Number.isFinite(wordDe) ? wordDe - 400 : 0,
				id: "emphasize-word-float",
				iterations: 1,
				composite: "add",
				fill: "both",
			});
			float.onfinish = () => {
				float.pause();
			};
			float.pause();
			result.push(float);

			return result;
		});

		return result;
	}

	private get totalDuration() {
		return this.lyricLine.endTime - this.lyricLine.startTime;
	}

	override onLineSizeChange(_size: [number, number]) {
		this.updateMaskImageSync();
	}
	updateMaskImageSync() {
		for (const word of this.splittedWords) {
			const el = word.mainElement;
			if (el) {
				word.padding = Number.parseFloat(getComputedStyle(el).paddingLeft);
				word.width = el.clientWidth - word.padding * 2;
				word.height = el.clientHeight - word.padding * 2;
			} else {
				word.width = 0;
				word.height = 0;
				word.padding = 0;
			}
		}
		if (this.lyricPlayer.supportMaskImage) {
			this.generateWebAnimationBasedMaskImage();
		} else {
			this.generateCalcBasedMaskImage();
		}
		if (this.isEnabled) {
			const isPlayerRunning = this.lyricPlayer.getIsPlaying?.() ?? true;
			this.enable(this.lyricPlayer.getCurrentTime(), isPlayerRunning);
		}
	}

	private generateCalcBasedMaskImage() {
		for (const word of this.splittedWords) {
			const wordEl = word.mainElement;
			if (wordEl) {
				word.width = wordEl.clientWidth;
				word.height = wordEl.clientHeight;
				const fadeWidth = word.height * this.lyricPlayer.getWordFadeWidth();
				const [maskImage, totalAspect] = generateFadeGradient(
					fadeWidth / word.width,
				);
				const totalAspectStr = `${totalAspect * 100}% 100%`;
				if (this.lyricPlayer.supportMaskImage) {
					wordEl.style.maskImage = maskImage;
					wordEl.style.maskRepeat = "no-repeat";
					wordEl.style.maskOrigin = "left";
					wordEl.style.maskSize = totalAspectStr;
				} else {
					wordEl.style.webkitMaskImage = maskImage;
					wordEl.style.webkitMaskRepeat = "no-repeat";
					wordEl.style.webkitMaskOrigin = "left";
					wordEl.style.webkitMaskSize = totalAspectStr;
				}
				const w = word.width + fadeWidth;
				const maskPos = `clamp(${-w}px,calc(${-w}px + (var(--amll-player-time) - ${
					word.startTime
				})*${
					w / Math.abs(word.endTime - word.startTime)
				}px),0px) 0px, left top`;
				wordEl.style.maskPosition = maskPos;
				wordEl.style.webkitMaskPosition = maskPos;
			}
		}
	}

	private generateWebAnimationBasedMaskImage() {
		// 鍥犱负姝岃瘝琛屾湁鍙兘姣旇鍐呭崟璇嶇殑缁撴潫鏃堕棿鏃╋紝鏈夊彲鑳藉鑷磋繃娓″姩鐢绘彁鏃╁仠姝㈠嚭鐜扮憰鐤?
		// 鎵€浠ヨ浠ュ崟璇嶇殑缁撴潫鏃堕棿涓哄噯
		const totalFadeDuration =
			Math.max(
				this.splittedWords.reduce((pv, w) => Math.max(w.endTime, pv), 0),
				this.lyricLine.endTime,
			) - this.lyricLine.startTime;
		this.splittedWords.forEach((word, i) => {
			const wordEl = word.mainElement;
			if (wordEl) {
				const fadeWidth = word.height * this.lyricPlayer.getWordFadeWidth();
				const [maskImage, totalAspect] = generateFadeGradient(
					fadeWidth / (word.width + word.padding * 2),
				);
				const totalAspectStr = `${totalAspect * 100}% 100%`;
				if (this.lyricPlayer.supportMaskImage) {
					wordEl.style.maskImage = maskImage;
					wordEl.style.maskRepeat = "no-repeat";
					wordEl.style.maskOrigin = "left";
					wordEl.style.maskSize = totalAspectStr;
				} else {
					wordEl.style.webkitMaskImage = maskImage;
					wordEl.style.webkitMaskRepeat = "no-repeat";
					wordEl.style.webkitMaskOrigin = "left";
					wordEl.style.webkitMaskSize = totalAspectStr;
				}
				// 涓轰簡灏藉彲鑳藉皢娓愬彉鍔ㄧ敾鍦ㄧ浉杩炵殑姣忎釜鍗曡瘝闂磋繎浼艰鎺ヨ捣鏉?
				// 瑕佺患鍚堟瘡涓崟璇嶇殑鏁堟灉鏃堕棿鍜岄棿闅欑敓鎴愬姩鐢诲抚鏁扮粍
				const widthBeforeSelf =
					this.splittedWords.slice(0, i).reduce((a, b) => a + b.width, 0) +
					(this.splittedWords[0] ? fadeWidth : 0);
				const minOffset = -(word.width + word.padding * 2 + fadeWidth);
				const clampOffset = (x: number) => Math.max(minOffset, Math.min(0, x));
				let curPos = -widthBeforeSelf - word.width - word.padding - fadeWidth;
				let timeOffset = 0;
				const frames: Keyframe[] = [];
				let lastPos = curPos;
				let lastTime = 0;
				const pushFrame = () => {
					// 姝ゅ濡傛灉娣诲姞杩囨浮鍑芥暟锛屼細瀵艰嚧鍗曡瘝鏃跺簭涓嶅噯纭紝鎵€浠ヤ笉娣诲姞
					// const easing = "cubic-bezier(.33,.12,.83,.9)";
					const moveOffset = curPos - lastPos;
					const time = Math.max(0, Math.min(1, timeOffset));
					const duration = time - lastTime;
					const d = Math.abs(duration / moveOffset);
					// 鍥犱负鏈夊彲鑳戒細鍜屼箣鍓嶇殑鍔ㄧ敾鏈夎竟鐣?
					if (curPos > minOffset && lastPos < minOffset) {
						const staticTime = Math.abs(lastPos - minOffset) * d;
						const value = `${clampOffset(lastPos)}px 0`;
						const frame: Keyframe = {
							offset: lastTime + staticTime,
							maskPosition: value,
						};
						frames.push(frame);
					}
					if (curPos > 0 && lastPos < 0) {
						const staticTime = Math.abs(lastPos) * d;
						const value = `${clampOffset(curPos)}px 0`;
						const frame: Keyframe = {
							offset: lastTime + staticTime,
							maskPosition: value,
						};
						frames.push(frame);
					}
					const value = `${clampOffset(curPos)}px 0`;
					const frame: Keyframe = {
						offset: time,
						maskPosition: value,
					};
					frames.push(frame);
					lastPos = curPos;
					lastTime = time;
				};
				pushFrame();
				let lastTimeStamp = 0;
				this.splittedWords.forEach((otherWord, j) => {
					// 鍋滈】
					{
						const curTimeStamp = otherWord.startTime - this.lyricLine.startTime;
						const staticDuration = curTimeStamp - lastTimeStamp;
						timeOffset += staticDuration / totalFadeDuration;
						if (staticDuration > 0) pushFrame();
						lastTimeStamp = curTimeStamp;
					}
					// 绉诲姩
					{
						const fadeDuration = Math.max(
							0,
							otherWord.endTime - otherWord.startTime,
						);
						const rubySegments = this.getRubySegments(otherWord);
						const rubyCharCount = rubySegments.reduce(
							(total, ruby) => total + ruby.word.length,
							0,
						);
						if (rubyCharCount > 0) {
							const widthPerChar = otherWord.width / rubyCharCount;
							let charIndex = 0;
							for (const ruby of rubySegments) {
								const rubyStartTime = Number.isFinite(ruby.startTime)
									? ruby.startTime
									: otherWord.startTime;
								const rubyEndTime = Number.isFinite(ruby.endTime)
									? ruby.endTime
									: otherWord.endTime;
								const rubyStart = Math.max(rubyStartTime, otherWord.startTime);
								const rubyEnd = Math.min(
									Math.max(rubyEndTime, rubyStart),
									otherWord.endTime,
								);
								const rubyStartStamp = rubyStart - this.lyricLine.startTime;
								const rubyStaticDuration = rubyStartStamp - lastTimeStamp;
								timeOffset += rubyStaticDuration / totalFadeDuration;
								if (rubyStaticDuration > 0) pushFrame();
								lastTimeStamp = rubyStartStamp;
								const rubyDuration = Math.max(0, rubyEnd - rubyStart);
								const perCharDuration = rubyDuration / ruby.word.length;
								for (
									let rubyCharIndex = 0;
									rubyCharIndex < ruby.word.length;
									rubyCharIndex++
								) {
									timeOffset += perCharDuration / totalFadeDuration;
									curPos += widthPerChar;
									if (j === 0 && charIndex === 0) {
										curPos += fadeWidth * 1.5;
									}
									if (
										j === this.splittedWords.length - 1 &&
										charIndex === rubyCharCount - 1
									) {
										curPos += fadeWidth * 0.5;
									}
									if (perCharDuration > 0) pushFrame();
									lastTimeStamp += perCharDuration;
									charIndex++;
								}
							}
							const wordEndStamp = Math.max(
								otherWord.endTime - this.lyricLine.startTime,
								lastTimeStamp,
							);
							const wordTailDuration = wordEndStamp - lastTimeStamp;
							timeOffset += wordTailDuration / totalFadeDuration;
							if (wordTailDuration > 0) pushFrame();
							lastTimeStamp = wordEndStamp;
						} else {
							const segmentCount = 1;
							const segmentWidth = otherWord.width / segmentCount;
							const segmentDuration = fadeDuration / segmentCount;
							for (
								let segmentIndex = 0;
								segmentIndex < segmentCount;
								segmentIndex++
							) {
								timeOffset += segmentDuration / totalFadeDuration;
								curPos += segmentWidth;
								if (j === 0 && segmentIndex === 0) {
									curPos += fadeWidth * 1.5;
								}
								if (
									j === this.splittedWords.length - 1 &&
									segmentIndex === segmentCount - 1
								) {
									curPos += fadeWidth * 0.5;
								}
								if (segmentDuration > 0) pushFrame();
								lastTimeStamp += segmentDuration;
							}
						}
					}
				});
				for (const a of word.maskAnimations) {
					a.cancel();
				}
				try {
					// TODO: 濡傛灉姝ゅ鍔ㄧ敾甯ц绠楀嚭閿欙紝闇€瑕佷竴涓悗澶囨柟妗?
					// 姝ゅ濡傛灉娣诲姞杩囨浮鍑芥暟锛屼細瀵艰嚧鍗曡瘝鏃跺簭涓嶅噯纭紝鎵€浠ヤ笉娣诲姞
					const ani = wordEl.animate(frames, {
						duration: totalFadeDuration || 1,
						id: `fade-word-${word.word}-${i}`,
						fill: "both",
					});
					ani.pause();
					word.maskAnimations = [ani];
				} catch (err) {
					console.warn("应用渐变动画发生错误", frames, totalFadeDuration, err);
				}
			}
		});
	}
	getElement() {
		return this.element;
	}

	private updateMaskAlphaTargets(scale: number) {
		const factor = Math.max(0.0, Math.min(1.0, (scale - 0.97) / 0.03));
		const dynamicDarkAlpha = factor * 0.2 + 0.2;
		const dynamicBrightAlpha = factor * 0.8 + 0.2;

		if (this.renderMode === LyricLineRenderMode.SOLID) {
			this.targetBrightAlpha = dynamicDarkAlpha;
			this.targetDarkAlpha = dynamicDarkAlpha;
		} else {
			this.targetBrightAlpha = dynamicBrightAlpha;
			this.targetDarkAlpha = dynamicDarkAlpha;
		}
	}

	private applyAlphaToDom(delta: number) {
		const dt = delta || 0.016;
		const ATTACK_SPEED = 50.0;
		const RELEASE_SPEED = 7.0;
		const getFactor = (speed: number) => 1 - Math.exp(-speed * dt);

		// 鏍规嵁鍗冲皢鍙樹寒杩樻槸鍙樻殫閫夋嫨閫熷害
		// 濡傛灉鍗冲皢鍙樹寒锛岃閫熷害闈炲父蹇紝浠ュ厤鎾斁鍒扮涓€涓瓧鐨勬椂鍊欓€忔槑搴﹁繕鍦ㄦ參鎱㈠鍔犲鑷寸湅涓嶆竻
		const isBrightening = this.targetBrightAlpha > this.currentBrightAlpha;
		const brightSpeed = isBrightening ? ATTACK_SPEED : RELEASE_SPEED;
		const brightFactor = getFactor(brightSpeed);

		if (Math.abs(this.targetBrightAlpha - this.currentBrightAlpha) < 0.001) {
			this.currentBrightAlpha = this.targetBrightAlpha;
		} else {
			this.currentBrightAlpha +=
				(this.targetBrightAlpha - this.currentBrightAlpha) * brightFactor;
		}

		const isDarkening = this.targetDarkAlpha > this.currentDarkAlpha;
		const darkSpeed = isDarkening ? ATTACK_SPEED : RELEASE_SPEED;
		const darkFactor = getFactor(darkSpeed);

		if (Math.abs(this.targetDarkAlpha - this.currentDarkAlpha) < 0.001) {
			this.currentDarkAlpha = this.targetDarkAlpha;
		} else {
			this.currentDarkAlpha +=
				(this.targetDarkAlpha - this.currentDarkAlpha) * darkFactor;
		}

		this.element.style.setProperty(
			"--bright-mask-alpha",
			this.currentBrightAlpha.toFixed(3),
		);
		this.element.style.setProperty(
			"--dark-mask-alpha",
			this.currentDarkAlpha.toFixed(3),
		);
	}

	override setTransform(
		top: number = this.top,
		scale: number = this.scale,
		opacity = 1,
		blur = 0,
		force = false,
		delay = 0,
		mode: LyricLineRenderMode = LyricLineRenderMode.SOLID,
	) {
		super.setTransform(top, scale, opacity, blur, force, delay);
		this.renderMode = mode;
		const beforeInSight = this.isInSight;
		const enableSpring = this.lyricPlayer.getEnableSpring();
		this.top = top;
		this.scale = scale;
		this.delay = (delay * 1000) | 0;
		const main = this.element.children[0] as HTMLDivElement;
		const trans = this.element.children[1] as HTMLDivElement;
		const roman = this.element.children[2] as HTMLDivElement;
		// main.style.opacity = `${opacity *
		// 	(!this.hasFaded ? 1 : this.lyricPlayer._getIsNonDynamic() ? 1 : 0.3)
		// 	}`;
		const subopacity =
			opacity * (this.lyricPlayer._getIsNonDynamic() ? 0.5 : 0.3);
		main.style.opacity = `${opacity}`;
		trans.style.opacity = `${subopacity}`;
		roman.style.opacity = `${subopacity}`;
		if (force || !enableSpring) {
			this.blur = Math.min(32, blur);
			// if (force) this.element.classList.add(styles.tmpDisableTransition);
			// this.lineWebAnimationTransforms.posX.setTargetPosition(left);
			// this.lineWebAnimationTransforms.posY.setTargetPosition(top);
			// this.lineWebAnimationTransforms.scale.setTargetPosition(scale);
			this.lineTransforms.posY.setPosition(top);
			this.lineTransforms.scale.setPosition(scale);
			if (!enableSpring) {
				const afterInSight = this.isInSight;
				if (beforeInSight || afterInSight) {
					this.show();
				} else {
					this.hide();
				}
			} else this.rebuildStyle();
			// if (force)
			// 	requestAnimationFrame(() => {
			// 		this.element.classList.remove(styles.tmpDisableTransition);
			// 	});
			const currentScale = this.lineTransforms.scale.getCurrentPosition();
			this.updateMaskAlphaTargets(currentScale / 100);
			this.currentBrightAlpha = this.targetBrightAlpha;
			this.currentDarkAlpha = this.targetDarkAlpha;
			this.element.style.setProperty(
				"--bright-mask-alpha",
				String(this.currentBrightAlpha),
			);
			this.element.style.setProperty(
				"--dark-mask-alpha",
				String(this.currentDarkAlpha),
			);
		} else {
			// this.lineWebAnimationTransforms.posX.stop();
			// this.lineWebAnimationTransforms.posY.stop();
			// this.lineWebAnimationTransforms.scale.stop();
			this.lineTransforms.posY.setTargetPosition(top, delay);
			this.lineTransforms.scale.setTargetPosition(scale);
			if (this.blur !== Math.min(5, blur)) {
				this.blur = Math.min(5, blur);
				const roundedBlur = blur.toFixed(3);
				this.element.style.filter = `blur(${roundedBlur}px)`;
			}
		}
	}

	update(delta = 0) {
		if (!this.lyricPlayer.getEnableSpring()) return;

		this.lineTransforms.posY.update(delta);
		this.lineTransforms.scale.update(delta);

		if (this.isInSight) {
			this.show();
		} else {
			this.hide();
		}

		const currentScale = this.lineTransforms.scale.getCurrentPosition() / 100;
		this.updateMaskAlphaTargets(currentScale);
		this.applyAlphaToDom(delta);
	}

	_getDebugTargetPos(): string {
		return `[浣嶇Щ: ${this.top}; 缂╂斁: ${this.scale}; 寤舵椂: ${this.delay}]`;
	}

	get isInSight() {
		const t = this.lineTransforms.posY.getCurrentPosition();
		const h = this.lyricPlayer.lyricLinesSize.get(this)?.[1] ?? 0;
		const b = t + h;
		const pb = this.lyricPlayer.size[1];
		const ov = this.lyricPlayer.getOverscanPx();
		return !(t > pb + h + ov || b < -h - ov);
	}
	private disposeElements() {
		for (const realWord of this.splittedWords) {
			for (const a of realWord.elementAnimations) {
				a.cancel();
			}
			for (const a of realWord.maskAnimations) {
				a.cancel();
			}
			for (const sub of realWord.subElements) {
				sub.remove();
				sub.parentNode?.removeChild(sub);
			}
			realWord.elementAnimations = [];
			realWord.maskAnimations = [];
			realWord.subElements = [];
			if (realWord.mainElement?.parentNode) {
				realWord.mainElement.parentNode.removeChild(realWord.mainElement);
			}
		}
		this.splittedWords = [];
		const main = this.element.children[0] as HTMLDivElement;
		const trans = this.element.children[1] as HTMLDivElement;
		const roman = this.element.children[2] as HTMLDivElement;
		if (main) main.innerHTML = "";
		if (trans) trans.innerHTML = "";
		if (roman) roman.innerHTML = "";
	}
	override dispose(): void {
		this.disposeElements();
		this.lyricPlayer.resizeObserver.unobserve(this.element);
		this.element.remove();
	}
}


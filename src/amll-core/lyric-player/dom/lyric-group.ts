import { LyricLineGroupBase } from "#lyric/base/group.ts";
import styles from "#styles/lyric-player.module.css";
import { clamp01 } from "#utils/clamp.ts";
import type { DomLyricPlayer } from "./index.ts";
import type { LyricLineEl } from "./lyric-line.ts";

export class LyricLineGroup extends LyricLineGroupBase<LyricLineEl> {
	public element: HTMLElement;
	public bgWrapper?: HTMLElement;
	private lastIsActive?: boolean;
	private lastTransform = "";
	private lastOpacity = "";
	private lastFilter = "";
	private lastBgTransform = "";
	private lastBgMarginTop = "";
	private lastBgHidden?: boolean;

	constructor(
		public lyricPlayer: DomLyricPlayer,
		mainLine: LyricLineEl,
	) {
		super(mainLine);
		this.element = document.createElement("div");
		this.element.className = styles.lyricLineWrapper;
		this.element.appendChild(mainLine.getElement());
		this.posY.setPosition(window.innerHeight * 2);
	}

	get isInSight(): boolean {
		const t = this.posY.getCurrentPosition();
		const pb = this.lyricPlayer.size[1];
		if (!this.lyricPlayer.hasUsableViewport()) return false;

		const fontSize = Number.isFinite(this.lyricPlayer.baseFontSize)
			? this.lyricPlayer.baseFontSize
			: 24;
		const h =
			this.lyricPlayer.lyricGroupSize?.get(this)?.[1] ??
			fontSize * 1.6;
		const ov = this.lyricPlayer.getOverscanPx();

		return !(t > pb + h + ov || t < -h - ov);
	}

	show(): void {
		if (!this.element.parentElement) {
			const playerEl = this.lyricPlayer.getElement();
			const groups = this.lyricPlayer.currentLyricGroups;
			const myIndex = groups.indexOf(this);

			let referenceNode: HTMLElement | null = null;
			if (myIndex !== -1) {
				for (let i = myIndex + 1; i < groups.length; i++) {
					if (groups[i].element.parentElement === playerEl) {
						referenceNode = groups[i].element;
						break;
					}
				}
			}

			playerEl.insertBefore(this.element, referenceNode);

			this.lyricPlayer.resizeObserver.observe(this.element);
		}

		this.mainLine.show();
		this.bgLine?.show();
	}

	hide(): void {
		if (this.element.parentElement) {
			this.lyricPlayer.resizeObserver.unobserve(this.element);
			this.element.remove();

			this.mainLine.teardownContent();
			this.bgLine?.teardownContent();
		}
	}

	override update(delta: number): void {
		if (this.isInSight) {
			this.show();
		} else {
			this.hide();
		}

		super.update(delta);
	}

	addBgLine(bgLine: LyricLineEl): void {
		if (this.bgLine) {
			this.bgLine.dispose();
		}
		if (this.bgWrapper) {
			this.bgWrapper.remove();
		}

		this.bgLine = bgLine;
		this.lastIsActive = undefined;
		this.lastBgTransform = "";
		this.lastBgMarginTop = "";
		this.lastBgHidden = undefined;

		// 需要对比第一个词的开始时间而不是行起始时间，因为行的起始时间已经被
		// `syncMainAndBackgroundLines` 同步过了
		const bgStartTime =
			bgLine.getLine().words[0]?.startTime ?? bgLine.getLine().startTime;
		const mainStartTime =
			this.mainLine.getLine().words[0]?.startTime ??
			this.mainLine.getLine().startTime;

		this.isBgFirst = bgStartTime < mainStartTime;

		if (this.mainLine.getLine().isDuet) {
			bgLine.getElement().classList.add(styles.lyricDuetLine);
		}

		this.bgWrapper = document.createElement("div");
		this.bgWrapper.className = styles.bgWrapper;

		this.bgWrapper.appendChild(bgLine.getElement());

		const alwaysPostposition =
			this.lyricPlayer.getAlwaysPostpositionBackground();
		const shouldBgFirst = !alwaysPostposition && this.isBgFirst;

		if (shouldBgFirst) {
			this.bgWrapper.classList.add(styles.bgWrapperTop);
			this.element.insertBefore(this.bgWrapper, this.mainLine.getElement());
			this.bgSlideY.setPosition(80);
		} else {
			this.element.appendChild(this.bgWrapper);
		}
	}

	protected renderStyles(): void {
		const y = this.posY.getCurrentPosition().toFixed(1);
		const transform = `translateY(${y}px)`;
		const opacity = this.opacity.toString();
		const filter = `blur(${Math.min(5, this.blur)}px)`;

		if (transform !== this.lastTransform) {
			this.lastTransform = transform;
			this.element.style.transform = transform;
		}
		if (opacity !== this.lastOpacity) {
			this.lastOpacity = opacity;
			this.element.style.opacity = opacity;
		}
		if (filter !== this.lastFilter) {
			this.lastFilter = filter;
			this.element.style.filter = filter;
		}

		if (!this.lyricPlayer.getEnableSpring()) {
			this.element.style.transitionDelay = `${this.delay}ms`;
		}

		if (this.bgWrapper) {
			if (this.lastIsActive !== this.isActive) {
				this.lastIsActive = this.isActive;
				this.bgWrapper.classList.toggle(styles.bgWrapperActive, this.isActive);
			}

			const slideY = this.bgSlideY.getCurrentPosition();
			const slideYStr = slideY.toFixed(1);
			const activeProgress = clamp01(1 - Math.abs(slideY) / 80);

			const scaleStr = (0.8 + activeProgress * 0.2).toFixed(3);
			const bgTransform = `translateY(${slideYStr}%) scale(${scaleStr})`;
			if (bgTransform !== this.lastBgTransform) {
				this.lastBgTransform = bgTransform;
				this.bgWrapper.style.transform = bgTransform;
			}

			const alwaysPostposition =
				this.lyricPlayer.getAlwaysPostpositionBackground();
			const shouldBgFirst = !alwaysPostposition && this.isBgFirst;

			let marginTop = "";
			if (shouldBgFirst) {
				const bgHeight = this.bgWrapper.clientHeight || 0;
				const currentMarginTop = -bgHeight * (1 - activeProgress);
				marginTop = `${currentMarginTop.toFixed(1)}px`;
			}
			if (marginTop !== this.lastBgMarginTop) {
				this.lastBgMarginTop = marginTop;
				this.bgWrapper.style.marginTop = marginTop;
			}

			const targetHiddenYStr = shouldBgFirst ? "80.0" : "-80.0";
			const isHidden = slideYStr === targetHiddenYStr && !this.isActive;
			if (isHidden !== this.lastBgHidden) {
				this.lastBgHidden = isHidden;
				this.bgWrapper.classList.toggle(styles.bgWrapperHidden, isHidden);
			}
		}
	}

	override dispose(): void {
		super.dispose();
		this.lyricPlayer.resizeObserver.unobserve(this.element);
		this.element.remove();
	}
}

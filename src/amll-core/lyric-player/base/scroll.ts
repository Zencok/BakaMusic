import { clamp } from "#utils/clamp.ts";

/**
 * 播放器滚动状态。
 *
 * 这部分状态描述用户手势/滚轮滚动产生的临时偏移，以及当前允许滚动的范围。
 * 改状态仅记录用户如何把当前视图上下拖动，不决定应该滚动到哪一行，
 * 后者由时间线状态与布局计算共同决定。
 */
export interface PlayerScrollState {
	/** 允许的滚动偏移范围 */
	scrollBoundary: {
		/** 允许的最小偏移量 */
		minOffset: number;
		/** 允许的最大偏移量 */
		maxOffset: number;
	};
	/** 当前用户滚动带来的额外偏移量 */
	scrollOffset: number;
	/** 是否允许用户通过手势或滚轮滚动歌词视图 */
	allowScroll: boolean;
	/** 是否处于用户滚动过，尚未回归自动对齐的状态 */
	isScrolled: boolean;
	/** 是否正在进行滚动交互或惯性滚动 */
	isUserScrolling: boolean;
}

/**
 * 将滚动偏移量限制在当前允许的滚动边界内。
 *
 * 当手势滚动、滚轮滚动或惯性滚动更新了 {@link PlayerScrollState.scrollOffset}
 * 后，应调用本函数以避免视图越界。
 */
export function clampPlayerScrollOffset(scrollState: PlayerScrollState): void {
	scrollState.scrollOffset = clamp(
		scrollState.scrollOffset,
		scrollState.scrollBoundary.minOffset,
		scrollState.scrollBoundary.maxOffset,
	);
}

/**
 * 重置滚动状态到未发生用户滚动时的初始状态。
 *
 * 本函数会清除当前偏移，并结束“已滚动”与“正在滚动”的标记；
 * **不会清理**外部持有的计时器或事件监听器。
 */
export function resetPlayerScrollState(scrollState: PlayerScrollState): void {
	scrollState.isScrolled = false;
	scrollState.scrollOffset = 0;
	scrollState.isUserScrolling = false;
}

/**
 * {@link attachPlayerScrollHandlers} 所需的宿主回调。
 *
 * 这些回调将滚动模块与具体播放器实现解耦：
 * 滚动模块只负责处理输入事件和更新滚动状态，布局刷新、点击转发等副作用
 * 由宿主决定如何执行。
 */
export interface AttachPlayerScrollHandlersCallbacks {
	/** 开始一次滚动处理前调用，返回 `false` 可阻止本次滚动 */
	onBeginScroll: () => boolean;
	/** 一次滚动交互或惯性滚动结束时调用 */
	onEndScroll: () => void;
	/** 请求宿主重新布局 */
	onLayout: (sync: boolean, force: boolean) => void;
	/** 判断某个点击目标是否仍属于当前播放器视图 */
	containsTarget: (target: Node) => boolean;
	/** 将点击事件转发给命中的目标元素 */
	clickTarget: (target: HTMLElement) => void;
}

/** 滚轮停止后结束 isUserScrolling 的空闲时间（ms） */
const WHEEL_IDLE_END_MS = 140;

/**
 * 向指定元素挂载歌词滚动相关的交互处理器。
 *
 * 该函数会处理：
 * - 触摸拖拽滚动
 * - 触摸结束后的惯性滚动
 * - 滚轮滚动
 * - 轻触时的点击透传
 *
 * 只更新 {@link PlayerScrollState} 并通过回调通知宿主执行布局或其它副作用，
 * 不直接依赖具体的播放器类实现。
 *
 * 手动滚动策略：
 * - 触摸 / 滚轮输入合并到 animation frame 后再布局，避免同一帧多次 calcLayout
 * - 手动偏移走弹簧目标（force=false），与自动跟唱同一套连续动画
 * - 滚轮会设置 isUserScrolling，结束后再恢复模糊等表现
 */
export function attachPlayerScrollHandlers(
	element: HTMLElement,
	scrollState: PlayerScrollState,
	callbacks: AttachPlayerScrollHandlersCallbacks,
): void {
	let startScrollY = 0;

	let startTouchPosY = 0;
	let startTouchStartX = 0;
	let startTouchStartY = 0;

	let lastMoveY = 0;
	let startScrollTime = 0;
	let scrollSpeed = 0;
	let curScrollId = 0;

	let wheelFrame = 0;
	let pendingWheelDelta = 0;
	let wheelIdleTimer: ReturnType<typeof setTimeout> | undefined;

	let touchFrame = 0;
	let pendingTouchOffset: number | null = null;

	const layoutAnimated = () => {
		// force=false：把偏移交给 Y 弹簧，保留与自动跟唱一致的连续动画
		// sync=true：关闭行间 delay 错落，整页一起跟手滑动
		callbacks.onLayout(true, false);
	};

	const flushTouchMove = () => {
		touchFrame = 0;
		if (pendingTouchOffset === null) return;
		scrollState.scrollOffset = pendingTouchOffset;
		pendingTouchOffset = null;
		clampPlayerScrollOffset(scrollState);
		layoutAnimated();
	};

	const scheduleTouchMove = (nextOffset: number) => {
		pendingTouchOffset = nextOffset;
		if (touchFrame === 0) {
			touchFrame = requestAnimationFrame(flushTouchMove);
		}
	};

	const endWheelInteraction = () => {
		wheelIdleTimer = undefined;
		if (pendingWheelDelta !== 0 || wheelFrame !== 0) {
			// 还有未刷出的位移时先交给 flush，结束标记在下一空闲再发
			wheelIdleTimer = setTimeout(endWheelInteraction, WHEEL_IDLE_END_MS);
			return;
		}
		if (!scrollState.isUserScrolling) return;
		scrollState.isUserScrolling = false;
		callbacks.onEndScroll();
	};

	const scheduleWheelEnd = () => {
		clearTimeout(wheelIdleTimer);
		wheelIdleTimer = setTimeout(endWheelInteraction, WHEEL_IDLE_END_MS);
	};

	const flushWheel = () => {
		wheelFrame = 0;
		if (pendingWheelDelta === 0) return;

		scrollState.scrollOffset += pendingWheelDelta;
		pendingWheelDelta = 0;
		clampPlayerScrollOffset(scrollState);
		layoutAnimated();
		scheduleWheelEnd();
	};

	const scheduleWheel = (delta: number) => {
		pendingWheelDelta += delta;
		if (wheelFrame === 0) {
			wheelFrame = requestAnimationFrame(flushWheel);
		}
	};

	element.addEventListener("touchstart", (evt) => {
		if (callbacks.onBeginScroll()) {
			// 取消滚轮空闲结束，避免触摸与滚轮状态交错
			clearTimeout(wheelIdleTimer);
			wheelIdleTimer = undefined;
			cancelAnimationFrame(wheelFrame);
			wheelFrame = 0;
			pendingWheelDelta = 0;

			scrollState.isUserScrolling = true;
			curScrollId++;

			evt.preventDefault();
			startScrollY = scrollState.scrollOffset;

			startTouchPosY = evt.touches[0].screenY;
			lastMoveY = startTouchPosY;

			startTouchStartX = evt.touches[0].screenX;
			startTouchStartY = evt.touches[0].screenY;

			startScrollTime = Date.now();
			scrollSpeed = 0;
			pendingTouchOffset = null;
			cancelAnimationFrame(touchFrame);
			touchFrame = 0;

			layoutAnimated();
		}
	});

	element.addEventListener("touchmove", (evt) => {
		if (!callbacks.onBeginScroll()) return;
		scrollState.isUserScrolling = true;
		evt.preventDefault();
		const currentY = evt.touches[0].screenY;

		const deltaY = currentY - startTouchPosY;
		const nextOffset = startScrollY - deltaY;

		const now = Date.now();
		const dt = now - startScrollTime;
		if (dt > 0) {
			scrollSpeed = (currentY - lastMoveY) / dt;
		}
		lastMoveY = currentY;
		startScrollTime = now;

		scheduleTouchMove(nextOffset);
	});

	element.addEventListener("touchend", (evt) => {
		if (!scrollState.isUserScrolling) {
			return;
		}
		evt.preventDefault();

		// 刷出最后一次 touchmove
		if (touchFrame !== 0) {
			cancelAnimationFrame(touchFrame);
			flushTouchMove();
		}

		const touch = evt.changedTouches[0];
		const moveX = Math.abs(touch.screenX - startTouchStartX);
		const moveY = Math.abs(touch.screenY - startTouchStartY);

		if (moveX < 10 && moveY < 10) {
			const target = document.elementFromPoint(touch.clientX, touch.clientY);
			if (target instanceof HTMLElement && callbacks.containsTarget(target)) {
				callbacks.clickTarget(target);
			}
			scrollState.isUserScrolling = false;
			callbacks.onEndScroll();
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
				scrollState.scrollOffset -= scrollSpeed * dt;

				clampPlayerScrollOffset(scrollState);

				const frictionFactor = 0.95 ** (dt / 16);
				scrollSpeed *= frictionFactor;

				layoutAnimated();

				requestAnimationFrame(onScrollFrame);
			} else {
				scrollState.isUserScrolling = false;
				callbacks.onEndScroll();
			}
		};

		requestAnimationFrame(onScrollFrame);
	});

	element.addEventListener(
		"wheel",
		(evt) => {
			if (!callbacks.onBeginScroll()) return;
			evt.preventDefault();

			// 取消触摸惯性，避免两套输入叠加速度
			curScrollId++;
			scrollState.isUserScrolling = true;

			const delta =
				evt.deltaMode === evt.DOM_DELTA_PIXEL
					? evt.deltaY
					: evt.deltaY * 50;
			scheduleWheel(delta);
			scheduleWheelEnd();
		},
		{ passive: false },
	);
}

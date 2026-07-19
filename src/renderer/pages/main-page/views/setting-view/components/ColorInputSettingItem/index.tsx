import { Popover } from "@headlessui/react";
import "./index.scss";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HexColorPicker } from "react-colorful";
import useAppConfig from "@/hooks/useAppConfig";
import { IAppConfig } from "@/types/app-config";
import AppConfig from "@shared/app-config/renderer";
import debounce from "@/common/debounce";

type ColorFormat = "hex" | "rgb" | "hsl";

interface IColorInputSettingItemProps<T extends keyof IAppConfig> {
    keyPath: T;
    label?: string;
}

interface IColorValue {
    red: number;
    green: number;
    blue: number;
    alpha: number;
}

const FORMAT_OPTIONS: Array<{ label: string; value: ColorFormat }> = [
    { label: "HEX", value: "hex" },
    { label: "RGB", value: "rgb" },
    { label: "HSL", value: "hsl" },
];

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(value, max));
}

function clampByte(value: number) {
    return Math.round(clamp(value, 0, 255));
}

function clampAlpha(value: number) {
    return clamp(value, 0, 1);
}

function toHexByte(value: number) {
    return clampByte(value).toString(16).padStart(2, "0");
}

function parseAlpha(value: string | undefined) {
    if (!value) {
        return 1;
    }
    const trimmedValue = value.trim();
    if (trimmedValue.endsWith("%")) {
        return clampAlpha(Number(trimmedValue.slice(0, -1)) / 100);
    }
    return clampAlpha(Number(trimmedValue));
}

function parseHexColor(value: string): IColorValue | null {
    const rawValue = value.trim().replace(/^#/, "");
    if (![3, 4, 6, 8].includes(rawValue.length) || /[^0-9a-f]/i.test(rawValue)) {
        return null;
    }

    const expandedValue =
        rawValue.length <= 4
            ? rawValue
                .split("")
                .map((char) => `${char}${char}`)
                .join("")
            : rawValue;

    return {
        red: parseInt(expandedValue.slice(0, 2), 16),
        green: parseInt(expandedValue.slice(2, 4), 16),
        blue: parseInt(expandedValue.slice(4, 6), 16),
        alpha: expandedValue.length === 8 ? parseInt(expandedValue.slice(6, 8), 16) / 255 : 1,
    };
}

function parseRgbColor(value: string): IColorValue | null {
    const match = value
        .trim()
        .match(
            /^rgba?\(\s*([0-9.]+%?)\s*,\s*([0-9.]+%?)\s*,\s*([0-9.]+%?)(?:\s*,\s*([0-9.]+%?))?\s*\)$/i,
        );
    if (!match) {
        return null;
    }

    const parseChannel = (channel: string) => {
        if (channel.endsWith("%")) {
            return clampByte(Number(channel.slice(0, -1)) * 2.55);
        }
        return clampByte(Number(channel));
    };

    return {
        red: parseChannel(match[1]),
        green: parseChannel(match[2]),
        blue: parseChannel(match[3]),
        alpha: parseAlpha(match[4]),
    };
}

function hueToRgb(start: number, end: number, hue: number) {
    let normalizedHue = hue;
    if (normalizedHue < 0) {
        normalizedHue += 1;
    }
    if (normalizedHue > 1) {
        normalizedHue -= 1;
    }
    if (normalizedHue < 1 / 6) {
        return start + (end - start) * 6 * normalizedHue;
    }
    if (normalizedHue < 1 / 2) {
        return end;
    }
    if (normalizedHue < 2 / 3) {
        return start + (end - start) * (2 / 3 - normalizedHue) * 6;
    }
    return start;
}

function hslToRgb(
    hue: number,
    saturation: number,
    lightness: number,
): Omit<IColorValue, "alpha"> {
    const normalizedHue = (((hue % 360) + 360) % 360) / 360;
    const normalizedSaturation = clamp(saturation, 0, 100) / 100;
    const normalizedLightness = clamp(lightness, 0, 100) / 100;

    if (normalizedSaturation === 0) {
        const lightnessByte = clampByte(normalizedLightness * 255);
        return {
            red: lightnessByte,
            green: lightnessByte,
            blue: lightnessByte,
        };
    }

    const end =
        normalizedLightness < 0.5
            ? normalizedLightness * (1 + normalizedSaturation)
            : normalizedLightness + normalizedSaturation - normalizedLightness * normalizedSaturation;
    const start = 2 * normalizedLightness - end;

    return {
        red: clampByte(hueToRgb(start, end, normalizedHue + 1 / 3) * 255),
        green: clampByte(hueToRgb(start, end, normalizedHue) * 255),
        blue: clampByte(hueToRgb(start, end, normalizedHue - 1 / 3) * 255),
    };
}

function parseHslColor(value: string): IColorValue | null {
    const match = value
        .trim()
        .match(
            /^hsla?\(\s*(-?[0-9.]+)(?:deg)?\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%(?:\s*,\s*([0-9.]+%?))?\s*\)$/i,
        );
    if (!match) {
        return null;
    }

    return {
        ...hslToRgb(Number(match[1]), Number(match[2]), Number(match[3])),
        alpha: parseAlpha(match[4]),
    };
}

function parseColor(value: string): IColorValue | null {
    if (!value) {
        return null;
    }

    if (value.trim().startsWith("#")) {
        return parseHexColor(value);
    }

    if (/^rgba?/i.test(value.trim())) {
        return parseRgbColor(value);
    }

    if (/^hsla?/i.test(value.trim())) {
        return parseHslColor(value);
    }

    return null;
}

function colorToHex(color: IColorValue, includeAlpha = color.alpha < 1) {
    const alpha = includeAlpha ? toHexByte(color.alpha * 255) : "";
    return `#${toHexByte(color.red)}${toHexByte(color.green)}${toHexByte(color.blue)}${alpha}`.toLowerCase();
}

function rgbToHsl(color: IColorValue) {
    const red = color.red / 255;
    const green = color.green / 255;
    const blue = color.blue / 255;
    const maxChannel = Math.max(red, green, blue);
    const minChannel = Math.min(red, green, blue);
    const lightness = (maxChannel + minChannel) / 2;

    if (maxChannel === minChannel) {
        return {
            hue: 0,
            saturation: 0,
            lightness: Math.round(lightness * 100),
        };
    }

    const delta = maxChannel - minChannel;
    const saturation =
        lightness > 0.5 ? delta / (2 - maxChannel - minChannel) : delta / (maxChannel + minChannel);
    let hue = 0;

    if (maxChannel === red) {
        hue = (green - blue) / delta + (green < blue ? 6 : 0);
    } else if (maxChannel === green) {
        hue = (blue - red) / delta + 2;
    } else {
        hue = (red - green) / delta + 4;
    }

    return {
        hue: Math.round(hue * 60),
        saturation: Math.round(saturation * 100),
        lightness: Math.round(lightness * 100),
    };
}

function formatColor(value: string, format: ColorFormat) {
    const color = parseColor(value) ?? parseHexColor("#ffffff");
    if (!color) {
        return value;
    }

    if (format === "rgb") {
        return color.alpha < 1
            ? `rgba(${color.red}, ${color.green}, ${color.blue}, ${Number(color.alpha.toFixed(2))})`
            : `rgb(${color.red}, ${color.green}, ${color.blue})`;
    }

    if (format === "hsl") {
        const hsl = rgbToHsl(color);
        return color.alpha < 1
            ? `hsla(${hsl.hue}, ${hsl.saturation}%, ${hsl.lightness}%, ${Number(color.alpha.toFixed(2))})`
            : `hsl(${hsl.hue}, ${hsl.saturation}%, ${hsl.lightness}%)`;
    }

    return colorToHex(color);
}

function normalizeColor(value: string) {
    const color = parseColor(value);
    if (!color) {
        return null;
    }
    // 桌面歌词字色不支持透明度：强制输出 6 位不透明 HEX，避免拖动 alpha 导致歌词不可见
    return colorToHex(color, false);
}

interface IColorPanelContentProps {
    buttonRef: React.RefObject<HTMLButtonElement | null>;
    close: () => void;
    draftColor: string;
    format: ColorFormat;
    inputValue: string;
    errorMessage: string | null;
    onMounted: () => void;
    onPickerPointerDown: () => void;
    onPickerChange: (color: string) => void;
    onFormatChange: (format: ColorFormat) => void;
    onInputChange: (value: string) => void;
    onCommit: () => void;
    onCancel: () => void;
}

/**
 * Color panel content. Portal into .setting-view--container (not body) so:
 * - Escape overflow/stacking from the scroll body and later cards
 * - Inherit --settingXxx CSS variables
 * Position is absolute relative to that shell (not fixed-to-viewport), so
 * transform / filter / backdrop-filter containing blocks cannot offset it.
 */
function ColorPanelContent(props: IColorPanelContentProps) {
    const {
        buttonRef,
        close,
        draftColor,
        format,
        inputValue,
        errorMessage,
        onMounted,
        onPickerPointerDown,
        onPickerChange,
        onFormatChange,
        onInputChange,
        onCommit,
        onCancel,
    } = props;
    const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
    const [panelPosition, setPanelPosition] = useState<{
        top: number;
        left: number;
        position: "absolute" | "fixed";
    } | null>(null);
    const closeRef = useRef(close);
    closeRef.current = close;
    const onMountedRef = useRef(onMounted);
    onMountedRef.current = onMounted;

    useLayoutEffect(() => {
        const button = buttonRef.current;
        const target = (button?.closest(".setting-view--container") as HTMLElement | null) ?? document.body;
        setPortalTarget(target);

        const computePosition = () => {
            const anchor = buttonRef.current;
            if (!anchor?.isConnected || !target.isConnected) {
                return;
            }
            const rect = anchor.getBoundingClientRect();
            const panelWidth = 256;
            const panelHeight = 380;
            const gap = 8;
            const margin = 8;
            let viewportTop = rect.bottom + gap;
            if (viewportTop + panelHeight > window.innerHeight - margin) {
                const flippedTop = rect.top - panelHeight - gap;
                viewportTop = flippedTop >= margin
                    ? flippedTop
                    : Math.max(margin, window.innerHeight - panelHeight - margin);
            }
            let viewportLeft = rect.left;
            if (viewportLeft + panelWidth > window.innerWidth - margin) {
                viewportLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
            }

            const useAbsolute = target !== document.body
                && getComputedStyle(target).position !== "static";
            if (useAbsolute) {
                const rootRect = target.getBoundingClientRect();
                setPanelPosition({
                    position: "absolute",
                    top: viewportTop - rootRect.top + target.scrollTop,
                    left: viewportLeft - rootRect.left + target.scrollLeft,
                });
                return;
            }

            setPanelPosition({
                position: "fixed",
                top: viewportTop,
                left: viewportLeft,
            });
        };

        onMountedRef.current();
        computePosition();

        const handleViewportChange = () => {
            closeRef.current();
        };
        window.addEventListener("scroll", handleViewportChange, true);
        window.addEventListener("resize", handleViewportChange);
        return () => {
            window.removeEventListener("scroll", handleViewportChange, true);
            window.removeEventListener("resize", handleViewportChange);
        };
    }, [buttonRef]);

    if (!portalTarget) {
        return null;
    }

    return createPortal(
        <Popover.Panel
            static
            className="setting-color-input-panel shadow backdrop-color"
            style={panelPosition
                ? {
                    top: panelPosition.top,
                    left: panelPosition.left,
                    position: panelPosition.position,
                }
                : { visibility: "hidden" }}
        >
            <div
                className="setting-color-input-picker"
                onPointerDownCapture={onPickerPointerDown}
            >
                <HexColorPicker
                    color={draftColor}
                    onChange={onPickerChange}
                ></HexColorPicker>
            </div>
            <div className="setting-color-input-format-list">
                {FORMAT_OPTIONS.map((option) => (
                    <button
                        className="setting-color-input-format"
                        data-active={format === option.value}
                        key={option.value}
                        onClick={() => {
                            onFormatChange(option.value);
                        }}
                        type="button"
                    >
                        {option.label}
                    </button>
                ))}
            </div>
            <input
                className="setting-color-input-value"
                onChange={(event) => {
                    onInputChange(event.target.value);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        onCommit();
                    }
                }}
                placeholder="#ffffff / rgb(255,255,255) / hsl(0,0%,100%)"
                value={inputValue}
            ></input>
            {errorMessage ? (
                <div className="setting-color-input-error">{errorMessage}</div>
            ) : null}
            <div className="setting-color-input-actions">
                <button
                    onClick={onCancel}
                    type="button"
                >
                    取消
                </button>
                <button
                    data-primary="true"
                    onClick={onCommit}
                    type="button"
                >
                    提交
                </button>
            </div>
        </Popover.Panel>,
        portalTarget,
    );
}

export default function ColorInputSettingItem<T extends keyof IAppConfig>(
    props: IColorInputSettingItemProps<T>,
) {
    const { keyPath, label } = props;
    const realColor = useAppConfig(keyPath) as string;
    const safeRealColor = useMemo(() => {
        return normalizeColor(realColor || "#ffffff") ?? "#ffffff";
    }, [realColor]);
    const [format, setFormat] = useState<ColorFormat>("hex");
    const [draftColor, setDraftColor] = useState(safeRealColor);
    const [inputValue, setInputValue] = useState(formatColor(safeRealColor, "hex"));
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const buttonRef = useRef<HTMLButtonElement>(null);
    // 标记 picker 拖动期间，短路外部 config 回流，避免拖动时面板跳动
    const isDraggingRef = useRef(false);
    // 记录本组件刚通过 debounced setConfig 写出的归一化值，回流命中则忽略（防抖动竞态）
    const selfUpdateRef = useRef<string | null>(null);
    // 打开面板时的已提交颜色快照，供「取消」回滚
    const originalColorRef = useRef(safeRealColor);

    // 拖动 picker 时实时写 config，使桌面歌词窗口即时跟随预览。
    // 必须显式 leading:false/trailing:true（项目 debounce 默认 leading:true 会丢松手最后一帧）。
    const debouncedPreview = useMemo(
        () =>
            debounce(
                (hex: string) => {
                    selfUpdateRef.current = hex;
                    AppConfig.setConfig({
                        [keyPath]: hex as any,
                    });
                },
                100,
                {
                    leading: false,
                    trailing: true,
                    maxWait: 200,
                },
            ),
        [keyPath],
    );

    useEffect(() => {
        // react-colorful 无 onChangeEnd：用全局 pointerup 收尾，落地最后一帧并延一帧解除拖动守卫
        const handlePointerUp = () => {
            if (!isDraggingRef.current) {
                return;
            }
            debouncedPreview.flush();
            requestAnimationFrame(() => {
                isDraggingRef.current = false;
            });
        };
        window.addEventListener("pointerup", handlePointerUp);
        return () => {
            window.removeEventListener("pointerup", handlePointerUp);
            debouncedPreview.cancel();
        };
    }, [debouncedPreview]);

    useEffect(() => {
        if (isDraggingRef.current) {
            // 拖动中：不让外部 config 回流覆盖用户正在拖的颜色
            return;
        }
        if (selfUpdateRef.current && safeRealColor === selfUpdateRef.current) {
            // 本组件自己发起的回流：不重置 draftColor，避免跳动
            selfUpdateRef.current = null;
            setInputValue(formatColor(safeRealColor, format));
            return;
        }
        // 外部/其它窗口真正改了值才接受并重置草稿
        setDraftColor(safeRealColor);
        setInputValue(formatColor(safeRealColor, format));
        setErrorMessage(null);
    }, [format, safeRealColor]);

    const handlePanelOpen = () => {
        originalColorRef.current = safeRealColor;
        isDraggingRef.current = false;
        selfUpdateRef.current = null;
        setDraftColor(safeRealColor);
        setInputValue(formatColor(safeRealColor, format));
        setErrorMessage(null);
    };

    const handlePickerPointerDown = () => {
        isDraggingRef.current = true;
    };

    const commitColor = (close: () => void) => {
        debouncedPreview.flush();
        const nextColor = normalizeColor(inputValue);
        if (!nextColor) {
            setErrorMessage("请输入 HEX、RGB 或 HSL 颜色");
            return;
        }
        isDraggingRef.current = false;
        selfUpdateRef.current = nextColor;
        AppConfig.setConfig({
            [keyPath]: nextColor as any,
        });
        setDraftColor(nextColor);
        setInputValue(formatColor(nextColor, format));
        setErrorMessage(null);
        close();
    };

    const cancelColor = (close: () => void) => {
        debouncedPreview.cancel();
        isDraggingRef.current = false;
        const originalColor = originalColorRef.current;
        selfUpdateRef.current = originalColor;
        // 回写打开时的快照，桌面歌词同步回滚
        AppConfig.setConfig({
            [keyPath]: originalColor as any,
        });
        setDraftColor(originalColor);
        setInputValue(formatColor(originalColor, format));
        setErrorMessage(null);
        close();
    };

    const changeDraftColor = (nextColor: string) => {
        isDraggingRef.current = true;
        setDraftColor(nextColor);
        setInputValue(formatColor(nextColor, format));
        setErrorMessage(null);
        const normalized = normalizeColor(nextColor);
        if (normalized) {
            debouncedPreview(normalized);
        }
    };

    const changeInputValue = (nextValue: string) => {
        setInputValue(nextValue);
        const nextColor = normalizeColor(nextValue);
        if (nextColor) {
            setDraftColor(nextColor);
            setErrorMessage(null);
        }
    };

    return (
        <Popover className="setting-row setting-color-input-row">
            {({ open, close }) => (
                <>
                    <div className="label-container">{label}</div>
                    <div className="setting-color-input-summary">
                        <Popover.Button
                            ref={buttonRef}
                            className="setting-color-input-swatch"
                            style={{
                                backgroundColor: safeRealColor,
                            }}
                            title={safeRealColor}
                        ></Popover.Button>
                        <span>{safeRealColor}</span>
                    </div>
                    {open ? (
                        <ColorPanelContent
                            buttonRef={buttonRef}
                            close={close}
                            draftColor={draftColor}
                            format={format}
                            inputValue={inputValue}
                            errorMessage={errorMessage}
                            onMounted={handlePanelOpen}
                            onPickerPointerDown={handlePickerPointerDown}
                            onPickerChange={changeDraftColor}
                            onFormatChange={setFormat}
                            onInputChange={changeInputValue}
                            onCommit={() => commitColor(close)}
                            onCancel={() => cancelColor(close)}
                        />
                    ) : null}
                </>
            )}
        </Popover>
    );
}

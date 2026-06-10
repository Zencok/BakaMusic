import Store from "@/common/store";
import SvgAsset, { SvgAssetIconNames } from "@/renderer/components/SvgAsset";
import {
    getQualityAbbr,
    isAiUpscaleQuality,
    type IMusicQualityChoice,
} from "@/renderer/utils/music-quality";
import { CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./index.scss";

interface IAnchorRect {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
}

interface IQualitySelectPopoverState {
    title: string;
    choices: IMusicQualityChoice[];
    defaultValue?: IMusic.IQualityKey;
    anchorRect?: IAnchorRect;
    onSelect?: (value: IMusic.IQualityKey) => void | Promise<void>;
}

interface IShowQualitySelectPopoverPayload extends Omit<IQualitySelectPopoverState, "anchorRect"> {
    anchor?: HTMLElement | DOMRect | IAnchorRect | null;
}

interface IQualityGroup {
    key: "ai" | "standard";
    choices: IMusicQualityChoice[];
}

const popoverStore = new Store<IQualitySelectPopoverState | null>(null);
const VIEWPORT_MARGIN = 10;
const ANCHOR_GAP = 10;

function normalizeAnchorRect(anchor?: HTMLElement | DOMRect | IAnchorRect | null): IAnchorRect | undefined {
    if (!anchor) {
        return undefined;
    }

    const rect = anchor instanceof HTMLElement
        ? anchor.getBoundingClientRect()
        : anchor;

    return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
    };
}

function getQualityIconName(quality: IMusic.IQualityKey): SvgAssetIconNames {
    if (isAiUpscaleQuality(quality)) {
        return "sparkles";
    }

    switch (quality) {
        case "mgg":
        case "128k":
            return "lq";
        case "192k":
            return "mq";
        case "320k":
            return "hq";
        case "flac":
        case "flac24bit":
        case "hires":
            return "sq";
        case "vinyl":
        case "dolby":
            return "cd";
        default:
            return "headphone";
    }
}

export function showQualitySelectPopover(payload: IShowQualitySelectPopoverPayload) {
    popoverStore.setValue({
        title: payload.title,
        choices: payload.choices,
        defaultValue: payload.defaultValue,
        anchorRect: normalizeAnchorRect(payload.anchor),
        onSelect: payload.onSelect,
    });
}

export function hideQualitySelectPopover() {
    popoverStore.setValue(null);
}

export default function QualitySelectPopover() {
    const popoverState = popoverStore.useValue();
    const popoverRef = useRef<HTMLDivElement>(null);
    const [positionStyle, setPositionStyle] = useState<CSSProperties | null>(null);
    const [selectedValue, setSelectedValue] = useState<IMusic.IQualityKey | undefined>();
    const [submittingValue, setSubmittingValue] = useState<IMusic.IQualityKey | null>(null);

    const groups = useMemo<IQualityGroup[]>(() => {
        const choices = popoverState?.choices ?? [];
        const aiChoices = choices.filter((choice) => isAiUpscaleQuality(choice.value));
        const standardChoices = choices.filter((choice) => !isAiUpscaleQuality(choice.value));

        return [
            {
                key: "ai" as const,
                choices: aiChoices,
            },
            {
                key: "standard" as const,
                choices: standardChoices,
            },
        ].filter((group) => group.choices.length);
    }, [popoverState?.choices]);

    useEffect(() => {
        if (!popoverState) {
            setSelectedValue(undefined);
            setSubmittingValue(null);
            return;
        }

        setSelectedValue(
            popoverState.defaultValue && popoverState.choices.some((choice) => choice.value === popoverState.defaultValue)
                ? popoverState.defaultValue
                : popoverState.choices[0]?.value,
        );
        setSubmittingValue(null);
    }, [popoverState]);

    useLayoutEffect(() => {
        if (!popoverState) {
            setPositionStyle(null);
            return;
        }

        const popover = popoverRef.current;
        const anchorRect = popoverState.anchorRect;
        if (!popover || !anchorRect) {
            setPositionStyle(null);
            return;
        }

        const width = popover.offsetWidth;
        const height = popover.offsetHeight;
        const centeredLeft = anchorRect.left + anchorRect.width / 2 - width / 2;
        const left = Math.min(
            Math.max(VIEWPORT_MARGIN, centeredLeft),
            Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
        );

        let top = anchorRect.bottom + ANCHOR_GAP;
        if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
            top = anchorRect.top - height - ANCHOR_GAP;
        }

        setPositionStyle({
            left,
            top: Math.max(VIEWPORT_MARGIN, top),
        });
    }, [popoverState]);

    useEffect(() => {
        if (!popoverState) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code === "Escape") {
                event.preventDefault();
                hideQualitySelectPopover();
            }
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [popoverState]);

    if (!popoverState) {
        return null;
    }

    async function selectQuality(value: IMusic.IQualityKey) {
        if (!popoverState || submittingValue) {
            return;
        }

        setSelectedValue(value);
        setSubmittingValue(value);
        try {
            await popoverState.onSelect?.(value);
            hideQualitySelectPopover();
        } finally {
            setSubmittingValue(null);
        }
    }

    return (
        <div
            className="quality-select-popover-layer"
            role="button"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    hideQualitySelectPopover();
                }
            }}
        >
            <div
                className="quality-select-popover"
                data-placement={popoverState.anchorRect ? "anchored" : "center"}
                ref={popoverRef}
                role="dialog"
                style={positionStyle ?? undefined}
                onMouseDown={(event) => {
                    event.stopPropagation();
                }}
            >
                <div className="quality-select-popover-title">{popoverState.title}</div>
                <div className="quality-select-popover-body">
                    {groups.map((group, groupIndex) => (
                        <div
                            className="quality-select-popover-group"
                            key={group.key}
                        >
                            {group.key === "standard" && groupIndex > 0 ? (
                                <div className="quality-select-popover-divider">
                                    <span></span>
                                    <em>AI升频</em>
                                    <span></span>
                                </div>
                            ) : null}
                            {group.choices.map((choice) => {
                                const selected = selectedValue === choice.value;
                                const submitting = submittingValue === choice.value;

                                return (
                                    <div
                                        className="quality-select-popover-option"
                                        data-active={selected}
                                        data-ai={isAiUpscaleQuality(choice.value)}
                                        key={choice.value}
                                        role="button"
                                        title={choice.label}
                                        onClick={() => {
                                            void selectQuality(choice.value);
                                        }}
                                    >
                                        <div className="quality-select-popover-option-icon">
                                            <SvgAsset iconName={getQualityIconName(choice.value)}></SvgAsset>
                                        </div>
                                        <div className="quality-select-popover-option-main">
                                            <span className="quality-select-popover-option-title">
                                                {choice.qualityLabel}
                                            </span>
                                            {choice.sizeText ? (
                                                <span className="quality-select-popover-option-size">
                                                    {choice.sizeText}
                                                </span>
                                            ) : null}
                                        </div>
                                        <span className="quality-select-popover-option-abbr">
                                            {getQualityAbbr(choice.value)}
                                        </span>
                                        <SvgAsset iconName={submitting ? "rolling-1s" : "check"}></SvgAsset>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

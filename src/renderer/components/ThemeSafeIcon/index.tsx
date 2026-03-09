import { CSSProperties, memo } from "react";

type ThemeSafeIconName =
    | "play"
    | "pause"
    | "skip-left"
    | "skip-right"
    | "x-mark";

const ICON_SVG_MAP: Record<ThemeSafeIconName, string> = {
    "play": `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path fill="#000" fill-rule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clip-rule="evenodd" />
        </svg>
    `,
    "pause": `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path fill="#000" fill-rule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clip-rule="evenodd" />
        </svg>
    `,
    "skip-left": `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path fill="#000" d="M5.84871 6.29553C6.34871 6.29553 6.59871 6.54553 6.59871 7.04553L6.59871 17.5455C6.59871 18.0455 6.34871 18.2955 5.84871 18.2955L5.09871 18.2955C4.59871 18.2955 4.34871 18.0455 4.34871 17.5455L4.34871 7.04553C4.34871 6.54553 4.59871 6.29553 5.09871 6.29553L5.84871 6.29553ZM15.7937 6.60559C17.0437 5.89258 18.5987 6.79553 18.5987 8.23547L18.5987 16.3575C18.5987 17.7975 17.0437 18.7006 15.7937 17.9855L8.68571 13.9246C7.4257 13.2046 7.4257 11.3885 8.68571 10.6686L15.7937 6.60559Z" />
        </svg>
    `,
    "skip-right": `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path fill="#000" d="M18.1513 6.29553C17.6513 6.29553 17.4013 6.54553 17.4013 7.04553L17.4013 17.5455C17.4013 18.0455 17.6513 18.2955 18.1513 18.2955L18.9013 18.2955C19.4013 18.2955 19.6513 18.0455 19.6513 17.5455L19.6513 7.04553C19.6513 6.54553 19.4013 6.29553 18.9013 6.29553L18.1513 6.29553ZM8.20628 6.60559C6.95628 5.89258 5.40129 6.79553 5.40129 8.23547L5.40129 16.3575C5.40129 17.7975 6.95628 18.7006 8.20628 17.9855L15.3143 13.9246C16.5743 13.2046 16.5743 11.3885 15.3143 10.6686L8.20628 6.60559Z" />
        </svg>
    `,
    "x-mark": `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
    `,
};

const ICON_MASK_MAP = Object.fromEntries(
    Object.entries(ICON_SVG_MAP).map(([iconName, svg]) => [
        iconName,
        `url("data:image/svg+xml,${encodeURIComponent(svg.replace(/\s+/g, " ").trim())}")`,
    ]),
) as Record<ThemeSafeIconName, string>;

const ICON_OPTICAL_OFFSET_X: Partial<Record<ThemeSafeIconName, number>> = {
    "play": 1.6,
    "pause": 0.8,
};

interface IProps {
    iconName: ThemeSafeIconName;
    size?: number;
    title?: string;
    color?: string;
    style?: CSSProperties;
}

function ThemeSafeIcon(props: IProps) {
    const translateX = ICON_OPTICAL_OFFSET_X[props.iconName] ?? 0;

    return (
        <span
            aria-hidden="true"
            title={props.title}
            style={{
                width: props.size,
                height: props.size,
                display: "block",
                flexShrink: 0,
                backgroundColor: props.color ?? "currentColor",
                WebkitMaskImage: ICON_MASK_MAP[props.iconName],
                maskImage: ICON_MASK_MAP[props.iconName],
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskPosition: "center",
                maskPosition: "center",
                transform: translateX ? `translateX(${translateX}px)` : undefined,
                ...props.style,
            }}
        ></span>
    );
}

export default memo(ThemeSafeIcon);

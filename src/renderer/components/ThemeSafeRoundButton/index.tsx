import { CSSProperties, MouseEventHandler, useState } from "react";
import ThemeSafeIcon from "@/renderer/components/ThemeSafeIcon";

interface IProps {
    iconName: "play" | "pause" | "skip-left" | "skip-right" | "x-mark";
    iconSize: number;
    size: number;
    title?: string;
    color: string;
    background: string;
    hoverBackground?: string;
    borderColor?: string;
    shadow?: string;
    style?: CSSProperties;
    iconStyle?: CSSProperties;
    onClick?: MouseEventHandler<HTMLButtonElement>;
}

export default function ThemeSafeRoundButton(props: IProps) {
    const [hovered, setHovered] = useState(false);
    const [pressed, setPressed] = useState(false);

    const transform = pressed
        ? "scale(0.97)"
        : hovered
            ? "translateY(-1px)"
            : "none";

    return (
        <button
            type="button"
            title={props.title}
            onClick={props.onClick}
            onMouseEnter={() => {
                setHovered(true);
            }}
            onMouseLeave={() => {
                setHovered(false);
                setPressed(false);
            }}
            onMouseDown={() => {
                setPressed(true);
            }}
            onMouseUp={() => {
                setPressed(false);
            }}
            style={{
                all: "unset",
                boxSizing: "border-box",
                width: `${props.size}px`,
                minWidth: `${props.size}px`,
                maxWidth: `${props.size}px`,
                height: `${props.size}px`,
                minHeight: `${props.size}px`,
                maxHeight: `${props.size}px`,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                margin: 0,
                borderRadius: "999px",
                overflow: "hidden",
                flexShrink: 0,
                lineHeight: 0,
                fontSize: 0,
                userSelect: "none",
                cursor: "pointer",
                color: props.color,
                background: hovered
                    ? props.hoverBackground ?? props.background
                    : props.background,
                border: props.borderColor ? `1px solid ${props.borderColor}` : "none",
                boxShadow: props.shadow,
                transform,
                transition: "transform 160ms ease, background-color 160ms ease, color 160ms ease",
                ...props.style,
            }}
        >
            <ThemeSafeIcon
                iconName={props.iconName}
                size={props.iconSize}
                style={props.iconStyle}
            ></ThemeSafeIcon>
        </button>
    );
}

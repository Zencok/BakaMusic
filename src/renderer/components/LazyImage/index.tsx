import { ImgHTMLAttributes, useEffect, useRef, useState } from "react";

const DEFAULT_ROOT_MARGIN = "240px 0px";

function getDefaultObserverRoot() {
    if (typeof document === "undefined") {
        return null;
    }

    return document.querySelector("#page-container");
}

interface ILazyImageProps
    extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
    src?: string | null;
    fallbackSrc?: string;
    root?: Element | null;
    rootMargin?: string;
    releaseWhenHidden?: boolean;
}

export default function LazyImage(props: ILazyImageProps) {
    const {
        src,
        fallbackSrc,
        root,
        rootMargin = DEFAULT_ROOT_MARGIN,
        releaseWhenHidden = true,
        loading = "lazy",
        decoding = "async",
        ...restProps
    } = props;
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [isVisible, setIsVisible] = useState(
        typeof window === "undefined" ||
            typeof IntersectionObserver === "undefined",
    );
    const [displaySrc, setDisplaySrc] = useState<string | undefined>();

    useEffect(() => {
        const imageElement = imageRef.current;

        if (!imageElement || typeof IntersectionObserver === "undefined") {
            setIsVisible(true);
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const nextIsVisible = entries.some(
                    (entry) => entry.isIntersecting || entry.intersectionRatio > 0,
                );
                setIsVisible(nextIsVisible);
            },
            {
                root: root === undefined ? getDefaultObserverRoot() : root,
                rootMargin,
                threshold: 0.01,
            },
        );

        observer.observe(imageElement);

        return () => {
            observer.disconnect();
        };
    }, [root, rootMargin]);

    useEffect(() => {
        if (isVisible) {
            setDisplaySrc(src || fallbackSrc || undefined);
            return;
        }

        if (releaseWhenHidden) {
            setDisplaySrc(undefined);
        }
    }, [fallbackSrc, isVisible, releaseWhenHidden, src]);

    return (
        <img
            {...restProps}
            ref={imageRef}
            src={displaySrc}
            loading={loading}
            decoding={decoding}
        ></img>
    );
}

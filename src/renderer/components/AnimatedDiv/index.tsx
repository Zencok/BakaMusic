import React, { useMemo, useState, useEffect } from "react";



interface IProps
    extends React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLDivElement>,
        HTMLDivElement
    > {
    // 展示条件
    showIf?: boolean;
    // 挂载动画
    mountClassName?: string;
    // 卸载动画
    unmountClassName?: string;
    // 卸载动画后保留节点，避免重复初始化重型子组件
    keepMounted?: boolean;
    onMountAnimationEnd?: () => void;
    onUnmountAnimationEnd?: () => void;
}

/**
 * 动画div组件
 * @returns
 */
export default function AnimatedDiv(props: IProps) {
    const {
        showIf = true,
        mountClassName,
        unmountClassName,
        keepMounted = false,
        onMountAnimationEnd,
        onUnmountAnimationEnd,
        className,
        onAnimationEnd,
    } = props ?? {};

    const [shouldMount, setShouldMount] = useState(false);
    const [_animationPlaying, setAnimationPlaying] = useState(false);

    const filteredProps: Record<string, any> = useMemo(() => {
        const res = {
            ...(props ?? {}),
        } as any;
        delete res.showIf;
        delete res.mountClassName;
        delete res.unmountClassName;
        delete res.keepMounted;
        delete res.onMountAnimationEnd;
        delete res.onUnmountAnimationEnd;
        return res;
    }, [props]);

    useEffect(() => {
        if (showIf) {
            setShouldMount(true);
        } else if (!unmountClassName && !keepMounted) {
            setShouldMount(false);
        }
    }, [keepMounted, showIf, unmountClassName]);

    return shouldMount ? (
        <div
            {...(filteredProps)}
            className={`${className ?? ""} ${showIf ? mountClassName ?? "" : unmountClassName ?? ""
            }`}
            onAnimationEnd={(...args) => {
                // Descendant animations bubble through the wrapper. Only the
                // wrapper's own entrance/exit animation controls its lifecycle.
                if (args[0].target !== args[0].currentTarget) {
                    return;
                }
                onAnimationEnd?.(...args);
                if (!showIf) {
                    // 如果showIf是false，表示当前播放的是卸载状态的动画
                    if (!keepMounted) {
                        setShouldMount(false);
                    }
                    onUnmountAnimationEnd?.();
                } else {
                    setShouldMount(true);
                    onMountAnimationEnd?.();
                }
                setAnimationPlaying(prev => !prev);
            }}
        ></div>
    ) : null;
}

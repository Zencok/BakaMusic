import { useCallback, useLayoutEffect, useState } from "react";

export default function usePageMotion(shown: boolean) {
    const [settled, setSettled] = useState(false);

    useLayoutEffect(() => {
        setSettled(false);
        const timeout = window.setTimeout(() => setSettled(true), shown ? 520 : 440);
        return () => window.clearTimeout(timeout);
    }, [shown]);

    const finish = useCallback(() => setSettled(true), []);
    const phase = settled
        ? shown ? "visible" : "hidden"
        : shown ? "enter" : "exit";

    return { phase, finish };
}

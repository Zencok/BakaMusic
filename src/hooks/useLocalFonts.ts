import Store from "@/common/store";
import { useEffect } from "react";

const fontsStore = new Store<FontData[] | null>(null);
let fontsTask: Promise<FontData[] | null> | null = null;

async function initFonts() {
    if (fontsStore.getValue()) {
        return fontsStore.getValue();
    }
    if (fontsTask) {
        return fontsTask;
    }
    if (
        typeof window.queryLocalFonts !== "function" ||
        document.visibilityState !== "visible"
    ) {
        return null;
    }
    fontsTask = (async () => {
        const allFonts = await window.queryLocalFonts();
        fontsStore.setValue(allFonts);
        return allFonts;
    })().catch(() => null).finally(() => {
        fontsTask = null;
    });

    return fontsTask;
}

export default function useLocalFonts() {
    useEffect(() => {
        const loadFonts = () => {
            if (document.visibilityState === "visible") {
                initFonts();
            }
        };

        loadFonts();
        document.addEventListener("visibilitychange", loadFonts);

        return () => {
            document.removeEventListener("visibilitychange", loadFonts);
        };
    }, []);

    return fontsStore.useValue();
}

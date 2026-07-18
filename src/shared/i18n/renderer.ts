import i18n, { type ResourceKey } from "i18next";
import Store from "@/common/store";
import { initReactI18next } from "react-i18next";
import { IMod } from "./type";

i18n.use(initReactI18next);

const ns = "translation";

const langListStore = new Store<string[]>([]);

const mod = window["@shared/i18n" as any] as unknown as IMod;
let languageSubscriptionSetup = false;
let setupPromise: Promise<void> | null = null;

async function applyLanguage(lang: string, content: ResourceKey) {
    if (!i18n.hasResourceBundle(lang, ns)) {
        i18n.addResourceBundle(lang, ns, content);
    }
    await i18n.changeLanguage(lang);
}

async function setupI18nInternal() {
    const { allLangs = [], content, lang } = (await mod.setupLang()) || {};
    if (!lang || !content) {
        return;
    }
    langListStore.setValue(allLangs);
    await i18n.init({
        resources: {
            [lang]: {
                [ns]: content,
            },
        },
        lng: lang,
    });
    if (!languageSubscriptionSetup) {
        languageSubscriptionSetup = true;
        mod.onLanguageChanged((data) => {
            void applyLanguage(data.lang, data.content);
        });
    }
}

export function setupI18n() {
    if (!setupPromise) {
        setupPromise = setupI18nInternal().catch((error) => {
            setupPromise = null;
            throw error;
        });
    }
    return setupPromise;
}

export async function changeLang(lang: string): Promise<boolean> {
    const langData = await mod.changeLang(lang);
    if (!langData) {
        return false;
    }
    await applyLanguage(lang, langData.content);
    return true;
}

export const getLangList = langListStore.getValue;

export const isCN = () => i18n.language.includes("zh-CN");

export { i18n };

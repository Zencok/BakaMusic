import type { ResourceKey } from "i18next";

export interface ISetupData {
    allLangs: string[];
    lang: string;
    content: ResourceKey;
}

export interface IChangeLangData {
    lang: string;
    content: ResourceKey;
}

export interface IMod {
    setupLang: () => Promise<ISetupData | null>;
    changeLang: (lang: string) => Promise<IChangeLangData | null>;
    onLanguageChanged: (callback: (data: IChangeLangData) => void) => () => void;
}

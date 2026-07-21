import { localPluginName } from "@/common/constant";

/**
 * Default favorite playlist metadata.
 *
 * Do not call i18n here: this module is imported before setupI18n() runs, and
 * i18next returns `undefined` for translations until initialized. The UI always
 * localizes the favorite sheet title via `media.default_favorite_sheet_name`.
 */
export default {
    id: "favorite",
    title: "Favorites",
    platform: localPluginName,
    musicList: [],
    $$sortIndex: -1,
    $sortIndex: -1,
};

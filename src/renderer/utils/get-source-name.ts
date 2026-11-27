import PluginManager from "@shared/plugin-manager/renderer";
import { isV2Media } from "@/common/media-util";
import { i18n } from "@shared/i18n/renderer";

export default function getSourceName(platform?: string) {
    if (!platform) return "";
    return PluginManager.getPluginByPlatform(platform)?.name
        ?? (isV2Media({ platform }) ? i18n.t("plugin_management_page.binding_unavailable") : platform);
}

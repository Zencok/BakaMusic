import { setupI18n } from "@/shared/i18n/renderer";
import AppConfig from "@shared/app-config/renderer";
import messageBus from "@shared/message-bus/renderer/extension";
import setupKeyboardAccessibility from "@renderer/utils/accessibility";

export default async function () {
    setupKeyboardAccessibility();
    // TODO: broadcast
    await AppConfig.setup();
    await setupI18n();
    messageBus.subscribeAppState([
        "playerState",
        "musicItem",
        "repeatMode",
        "parsedLrc",
        "lyricText",
        "fullLyric",
        "lyricClock",
    ]);
    messageBus.sendCommand("SyncAppState");
}

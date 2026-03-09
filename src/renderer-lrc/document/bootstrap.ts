import AppConfig from "@shared/app-config/renderer";
import messageBus from "@shared/message-bus/renderer/extension";

export default async function () {
    await AppConfig.setup();
    messageBus.subscribeAppState(["playerState", "musicItem", "repeatMode", "parsedLrc", "lyricText", "fullLyric", "progress", "lyricClock"]);
    messageBus.sendCommand("SyncAppState");
}

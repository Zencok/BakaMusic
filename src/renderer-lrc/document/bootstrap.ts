import AppConfig from "@shared/app-config/renderer";
import messageBus from "@shared/message-bus/renderer/extension";

export default async function () {
    await AppConfig.setup();
    messageBus.subscribeAppState(["playerState", "musicItem", "fullLyric", "lyricClock"]);
    messageBus.sendCommand("SyncAppState");
}

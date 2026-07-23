import type { IMod } from "./type";

const nativePlayback = window["@shared/native-playback" as never] as unknown as IMod;

export default nativePlayback;

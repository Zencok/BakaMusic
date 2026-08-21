import type { mod } from "./preload-mv";

const mvOverlay = window["@shared/mv-overlay" as never] as unknown as typeof mod;

export default mvOverlay;

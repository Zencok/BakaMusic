import type { IMod } from "./type";

const nodeRuntime = window["@shared/node-runtime" as never] as unknown as IMod;

export default nodeRuntime;

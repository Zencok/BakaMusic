import Store from "@/common/store";
import type { DlnaDevice } from "@shared/dlna/common";

export const dlnaDeviceStore = new Store<DlnaDevice | null>(null);

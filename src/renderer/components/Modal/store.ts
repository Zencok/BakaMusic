import Store from "@/common/store";
import type templates from "./templates";

export type ModalTemplate = typeof templates;
export type ModalType = keyof ModalTemplate;

interface IModalInfo {
    type: ModalType | null;
    payload: any;
}

export const modalStore = new Store<IModalInfo>({
    type: null,
    payload: null,
});

export function hideModal() {
    modalStore.setValue({
        type: null,
        payload: null,
    });
}

export function isModalOpen() {
    return modalStore.getValue().type != null;
}

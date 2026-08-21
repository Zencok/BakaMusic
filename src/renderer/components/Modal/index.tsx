import templates from "./templates";
import { useMemo } from "react";
import {
    modalStore,
    type ModalTemplate,
} from "./store";

export { hideModal, isModalOpen } from "./store";

export default function ModalComponent() {
    const modalState = modalStore.useValue();

    const component = useMemo(() => {
        if (modalState.type) {
            const Component = templates[modalState.type];
            return <Component {...(modalState.payload ?? {})}></Component>;
        }
        return null;
    }, [modalState]);

    return component;
}

export function showModal<T extends keyof ModalTemplate>(
    type: T,
    payload?: Parameters<ModalTemplate[T]>[0],
) {
    modalStore.setValue({
        type,
        payload,
    });
}

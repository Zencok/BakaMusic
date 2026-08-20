import Store from "@/common/store";
import templates from "./templates";
import { useMemo } from "react";

type ITemplate = typeof templates;
type IPanelType = keyof ITemplate;

interface IPanelInfo {
    type: IPanelType | null;
    payload: any;
}

const panelStore = new Store<IPanelInfo>({
    type: null,
    payload: null,
});

export default function PanelComponent() {
    const modalState = panelStore.useValue();

    return useMemo(() => {
        if (modalState.type) {
            const Component = templates[modalState.type];
            return <Component {...(modalState.payload ?? {})}></Component>;
        }
        return null;
    }, [modalState]);
}

export function showPanel<T extends keyof ITemplate>(
    type: T,
    payload?: Parameters<ITemplate[T]>[0],
) {
    panelStore.setValue({
        type,
        payload,
    });
}

export function hidePanel() {
    panelStore.setValue({
        type: null,
        payload: null,
    });
}


export function getCurrentPanel(){
    return panelStore.getValue();
}

/** 订阅当前面板类型，供需要反映面板开合状态的按钮使用 */
const selectPanelType = (panel: IPanelInfo) => panel.type;

export function useCurrentPanelType() {
    return panelStore.useSelector(selectPanelType);
}

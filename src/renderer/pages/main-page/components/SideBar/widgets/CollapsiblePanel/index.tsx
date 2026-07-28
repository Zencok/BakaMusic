import { Disclosure } from "@headlessui/react";
import type { PropsWithChildren } from "react";

interface ICollapsiblePanelProps extends PropsWithChildren {
    className?: string;
    open: boolean;
}

export default function CollapsiblePanel(props: ICollapsiblePanelProps) {
    const { children, className, open } = props;

    return (
        <Disclosure.Panel
            aria-hidden={!open}
            className="side-bar-collapsible-panel"
            data-expanded={open}
            inert={!open}
            static
        >
            <div
                className={`side-bar-collapsible-panel-inner${className ? ` ${className}` : ""}`}
            >
                {children}
            </div>
        </Disclosure.Panel>
    );
}

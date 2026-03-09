import { ReactNode } from "react";

interface IConditionProps {
    condition: any;
    truthy?: ReactNode;
    falsy?: ReactNode;
    children?: ReactNode;
}

export default function Condition(props: IConditionProps) {
    const { condition, truthy, falsy, children } = props;
    return <>{condition ? truthy ?? children : falsy}</>;
}

interface IIfProps {
    condition: any;
    children?: any;
}

interface ICondProps {
    children?: ReactNode | ReactNode[];
}
function Truthy(props: ICondProps) {
    return <>{props?.children}</>;
}

function Falsy(props: ICondProps) {
    return <>{props?.children}</>;
}

function If(props: IIfProps) {
    const { condition, children } = props;

    if (!children) {
        return null;
    }

    const childList = Array.isArray(children) ? children : [children];
    const filteredChildren = childList.map((item: any) =>
        condition
            ? item.type !== Falsy
                ? item
                : null
            : item.type !== Truthy
                ? item
                : null,
    );

    return Array.isArray(children) ? filteredChildren : filteredChildren[0] ?? null;
}

If.Truthy = Truthy;
If.Falsy = Falsy;


function IfTruthy(props: IIfProps) {
    const { condition, children } = props;

    return condition ? children : null;
}

function IfFalsy(props: IIfProps) {
    const { condition, children } = props;

    return condition ? null : children;
}

export { If, IfTruthy, IfFalsy };

import type { ReactNode } from "react";

interface ISettingGroupProps {
    title: string;
    description?: string;
    children: ReactNode;
}

/** Visual sub-group inside a settings section. */
export default function SettingGroup(props: ISettingGroupProps) {
    const { title, description, children } = props;

    return (
        <div className="setting-group">
            <div className="setting-group--header">
                <div className="setting-group--title">{title}</div>
                {description ? (
                    <div className="setting-group--description">{description}</div>
                ) : null}
            </div>
            <div className="setting-group--body">{children}</div>
        </div>
    );
}

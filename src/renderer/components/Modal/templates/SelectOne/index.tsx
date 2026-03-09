import { useState } from "react";
import Condition from "@/renderer/components/Condition";
import SvgAsset from "@/renderer/components/SvgAsset";
import classNames from "@/renderer/utils/classnames";
import { useTranslation } from "react-i18next";
import { hideModal } from "../..";
import Base from "../Base";
import "./index.scss";

interface IProps {
    title: string;
    choices: Array<{
        label?: string;
        value: any;
    }>;
    extra?: string;
    onOk?: (value: any, extra?: boolean) => void;
    defaultValue?: any;
    defaultExtra?: boolean;
    autoOkOnSelect?: boolean;
}

export default function SelectOne(props: IProps) {
    const {
        title,
        choices,
        onOk,
        defaultValue,
        extra,
        defaultExtra,
        autoOkOnSelect,
    } = props;
    const [selectedIndex, setSelectedIndex] = useState<number>(
        defaultValue !== undefined
            ? choices.findIndex((choice) => choice.value === defaultValue)
            : -1,
    );
    const [extraChecked, setExtraChecked] = useState(defaultExtra ?? false);
    const { t } = useTranslation();

    return (
        <Base defaultClose withBlur>
            <div className="modal--select-one-container shadow backdrop-color">
                <Base.Header>{title}</Base.Header>
                <div className="modal--body-container">
                    {choices.map((choice, index) => (
                        <div
                            className="row-container"
                            key={choice.value}
                            role="button"
                            data-selected={selectedIndex === index}
                            onClick={async () => {
                                setSelectedIndex(index);
                                if (autoOkOnSelect) {
                                    await onOk?.(choice.value, extraChecked);
                                    hideModal();
                                }
                            }}
                        >
                            <div className="row-label">{choice.label ?? choice.value}</div>
                            <Condition condition={selectedIndex === index}>
                                <div className="row-checkmark">
                                    <SvgAsset iconName="check"></SvgAsset>
                                </div>
                            </Condition>
                        </div>
                    ))}
                </div>
                <div className="footer-options">
                    <Condition condition={extra}>
                        <div
                            className={classNames({
                                "footer-extra": true,
                                highlight: extraChecked,
                            })}
                            role="button"
                            onClick={() => {
                                setExtraChecked((prev) => !prev);
                            }}
                        >
                            <div className="checkbox">
                                <Condition condition={extraChecked}>
                                    <SvgAsset iconName="check"></SvgAsset>
                                </Condition>
                            </div>
                            <span>{extra}</span>
                        </div>
                    </Condition>
                    <Condition condition={!autoOkOnSelect}>
                        <div className="footer-buttons">
                            <div
                                role="button"
                                className="footer-button footer-button-secondary"
                                onClick={() => {
                                    hideModal();
                                }}
                            >
                                {t("common.cancel")}
                            </div>
                            <div
                                role="button"
                                className="footer-button footer-button-primary"
                                data-disabled={selectedIndex === -1}
                                onClick={async () => {
                                    onOk?.(choices[selectedIndex]?.value, extraChecked);
                                    hideModal();
                                }}
                            >
                                {t("common.confirm")}
                            </div>
                        </div>
                    </Condition>
                </div>
            </div>
        </Base>
    );
}


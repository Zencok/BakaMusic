import { useRef } from "react";
import Base from "../Base";
import "./index.scss";
import { hidePanel } from "../..";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import AppConfig from "@shared/app-config/renderer";

interface IUserVariablesProps {
    plugin: IPlugin.IPluginDelegate;
    variables: IPlugin.IUserVariable[];
    initValues?: Record<string, string>;
}

export default function (props: IUserVariablesProps) {
    const { variables = [], initValues = {}, plugin } = props;

    const valueRef = useRef<Record<string, string>>({ ...(initValues ?? {}) });
    const submittingRef = useRef(false);
    const { t } = useTranslation();

    return (
        <Base>
            <Base.Header
                right={
                    <div
                        role="button"
                        className="panel--user-variables-submit"
                        onClick={async () => {
                            if (submittingRef.current) {
                                return;
                            }
                            submittingRef.current = true;
                            // getConfig 返回的是配置内部对象，原地修改会让变更检测
                            // 判定为"无变化"而丢弃，必须构造新对象提交。
                            const currentMeta = AppConfig.getConfig("private.pluginMeta") ?? {};
                            let saved = false;
                            try {
                                saved = await AppConfig.setConfig({
                                    "private.pluginMeta": {
                                        ...currentMeta,
                                        [plugin.id]: {
                                            ...(currentMeta[plugin.id] ?? {}),
                                            userVariables: { ...valueRef.current },
                                        },
                                    },
                                });
                            } catch {
                                saved = false;
                            }

                            submittingRef.current = false;
                            if (saved) {
                                hidePanel();
                                toast.success(t("panel.user_variable_setting_success"));
                            } else {
                                // 保存失败时保留面板与已输入内容，便于重试
                                toast.error(t("panel.user_variable_setting_fail"));
                            }
                        }}
                    >
                        {t("common.confirm")}
                    </div>
                }
            >
                {plugin.name ?? ""} {t("panel.user_variable")}
            </Base.Header>
            <div className="panel--user-variables-container">
                {variables.map((variable) => (
                    <div className="panel--user-variable-item" key={variable.key}>
                        <span title={variable.name ?? variable.key}>
                            {variable.name ?? variable.key}
                        </span>
                        <input
                            spellCheck={false}
                            defaultValue={initValues[variable.key]}
                            onInput={(e) => {
                                valueRef.current[variable.key] = (
                                    e.target as HTMLInputElement
                                ).value;
                            }}
                            placeholder={variable.hint}
                        ></input>
                    </div>
                ))}
            </div>
        </Base>
    );
}

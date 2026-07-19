import "./index.scss";
import CheckBoxSettingItem from "../../components/CheckBoxSettingItem";
import SettingGroup from "../../components/SettingGroup";
import { useEffect, useRef, useState } from "react";

import hotkeys from "hotkeys-js";
import { useTranslation } from "react-i18next";
import useAppConfig from "@/hooks/useAppConfig";
import { IAppConfig } from "@/types/app-config";
import shortCut from "@shared/short-cut/renderer";
import { shortCutKeys } from "@/common/constant";
import SvgAsset from "@renderer/components/SvgAsset";

export default function ShortCut() {
    const { t } = useTranslation();

    return (
        <div className="setting-view--short-cut-container">
            <SettingGroup
                title={t("settings.group.shortcut_toggle")}
                description={t("settings.group.shortcut_toggle_desc")}
            >
                <CheckBoxSettingItem
                    keyPath="shortCut.enableLocal"
                    label={t("settings.short_cut.enable_local")}
                ></CheckBoxSettingItem>
                <CheckBoxSettingItem
                    keyPath="shortCut.enableGlobal"
                    label={t("settings.short_cut.enable_global")}
                ></CheckBoxSettingItem>
            </SettingGroup>

            <SettingGroup
                title={t("settings.group.shortcut_bindings")}
                description={t("settings.group.shortcut_bindings_desc")}
            >
                <ShortCutTable></ShortCutTable>
            </SettingGroup>
        </div>
    );
}

type IShortCutKeys = Extract<keyof NonNullable<IAppConfig["shortCut.shortcuts"]>, string>;

function ShortCutTable() {
    const { t } = useTranslation();

    const enableLocalShortCut = useAppConfig("shortCut.enableLocal");
    const enableGlobalShortCut = useAppConfig("shortCut.enableGlobal");
    const shortCuts = useAppConfig("shortCut.shortcuts");
    const shortcutKeys = shortCutKeys as IShortCutKeys[];

    return (
        <div className="setting-view--short-cut-table-container">
            <div className="setting-view--short-cut-table-header">
                <div className="short-cut-table-title">{t("settings.short_cut.ability")}</div>
                <div className="short-cut-table-bindings">
                    <div>{t("settings.short_cut.local_short_cut")}</div>
                    <div>{t("settings.short_cut.global_short_cut")}</div>
                </div>
            </div>
            {shortcutKeys.map((it) => (
                <div className="setting-view--short-cut-table-row" key={it}>
                    <div className="short-cut-ability">{t(`settings.short_cut.${it}`)}</div>
                    <div className="short-cut-bindings">
                        <div className="short-cut-binding">
                            <div className="short-cut-binding-label">
                                {t("settings.short_cut.local_short_cut")}
                            </div>
                            <ShortCutItem
                                enabled={!!enableLocalShortCut}
                                value={shortCuts?.[it]?.local ?? undefined}
                                onChange={(val) => {
                                    if (val) {
                                        shortCut.registerLocalShortCut(it, val);
                                    }
                                }}
                                showClearButton
                                onClear={() => {
                                    shortCut.unregisterLocalShortCut(it);
                                }}
                            ></ShortCutItem>
                        </div>
                        <div className="short-cut-binding">
                            <div className="short-cut-binding-label">
                                {t("settings.short_cut.global_short_cut")}
                            </div>
                            <ShortCutItem
                                enabled={!!enableGlobalShortCut}
                                value={shortCuts?.[it]?.global ?? undefined}
                                onChange={(val) => {
                                    if (val) {
                                        shortCut.registerGlobalShortCut(it, val);
                                    }
                                }}
                                showClearButton
                                onClear={() => {
                                    shortCut.unregisterGlobalShortCut(it);
                                }}
                            ></ShortCutItem>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

interface IShortCutItemProps {
    enabled?: boolean;
    isGlobal?: boolean;
    value?: string[];
    onChange?: (sc?: string[]) => void;
    showClearButton?: boolean;
    onClear?: () => void;
}

function formatValue(val: string[]) {
    return val.join(" + ");
}

function keyCodeMap(code: string) {
    switch (code) {
        case "arrowup":
            return "Up";
        case "arrowdown":
            return "Down";
        case "arrowleft":
            return "Left";
        case "arrowright":
            return "Right";
        default:
            return code;
    }
}

function ShortCutItem(props: IShortCutItemProps) {
    const { value, onChange, enabled, isGlobal, showClearButton, onClear } = props;
    const [tmpValue, setTmpValue] = useState<string[] | null>();
    const realValue = formatValue(tmpValue ?? value ?? []);
    const isRecordingRef = useRef(false);
    const scopeRef = useRef(Math.random().toString().slice(2));
    const recordedKeysRef = useRef(new Set<string>());
    const { t } = useTranslation();

    useEffect(() => {
        const scope = scopeRef.current;
        const handler = (evt: KeyboardEvent) => {
            const type = evt.type;
            let key = evt.key.toLowerCase();
            if (evt.code === "Space") {
                key = "Space";
            }
            if (type === "keydown") {
                isRecordingRef.current = true;
                if (key === "meta") {
                    setTmpValue(null);
                    isRecordingRef.current = false;
                    recordedKeysRef.current.clear();
                } else {
                    if (!recordedKeysRef.current.has(key)) {
                        recordedKeysRef.current.add(key);
                        setTmpValue(
                            [...recordedKeysRef.current].map((it) =>
                                it.replace(/^(.)/, (_, $1: string) => $1.toUpperCase()),
                            ),
                        );
                    }
                }
            } else if (type === "keyup" && isRecordingRef.current) {
                isRecordingRef.current = false;
                const recordedSet = recordedKeysRef.current;
                const _recordShortCutKey: string[] = [];

                let statusCode = 0;
                if (recordedSet.has("ctrl") || recordedSet.has("control")) {
                    _recordShortCutKey.push("Ctrl");
                    recordedSet.delete("ctrl");
                    recordedSet.delete("control");
                    statusCode |= 1;
                }
                if (recordedSet.has("command")) {
                    _recordShortCutKey.push("Command");
                    recordedSet.delete("command");
                    statusCode |= 1;
                }
                if (recordedSet.has("option")) {
                    _recordShortCutKey.push("Option");
                    recordedSet.delete("option");
                    statusCode |= 1;
                }
                if (recordedSet.has("shift")) {
                    _recordShortCutKey.push("Shift");
                    recordedSet.delete("shift");
                    statusCode |= 1;
                }

                if (recordedSet.has("alt")) {
                    _recordShortCutKey.push("Alt");
                    recordedSet.delete("alt");
                    statusCode |= 1;
                }

                if (recordedSet.size === 1 && (isGlobal ? statusCode : true)) {
                    _recordShortCutKey.push(
                        keyCodeMap([...recordedSet.values()][0] ?? "").replace(
                            /^(.)/,
                            (_, $1: string) => $1.toUpperCase(),
                        ),
                    );
                    setTmpValue(_recordShortCutKey);
                    onChange?.(_recordShortCutKey);
                } else {
                    setTmpValue(null);
                }

                recordedKeysRef.current.clear();
            }
        };
        hotkeys(
            "*",
            {
                scope,
                keyup: true,
            },
            handler,
        );
        return () => {
            hotkeys.unbind("*", scope, handler);
        };
    }, [isGlobal, onChange]);

    return (
        <div className="short-cut-item--container" data-disabled={!enabled}>
            <input
                data-capture="true"
                data-disabled={!enabled}
                data-show-clear-button={showClearButton}
                autoCorrect="off"
                autoCapitalize="off"
                type="text"
                readOnly
                aria-live="off"
                className="short-cut-item--input"
                value={realValue || t("settings.short_cut.no_short_cut")}
                onKeyDown={(e) => {
                    e.preventDefault();
                }}
                onFocus={() => {
                    hotkeys.setScope(scopeRef.current);
                }}
                onBlur={() => {
                    hotkeys.setScope("all");
                    setTmpValue(null);
                    recordedKeysRef.current.clear();
                }}
            >
            </input>
            {
                (enabled && showClearButton) ? <button
                    className="short-cut-item--clear-button"
                    title={t("common.clear")}
                    aria-label={t("common.clear")}
                    type="button"
                    onClick={onClear}
                >
                    <SvgAsset iconName='x-mark'></SvgAsset>
                </button> : null
            }
        </div>
    );
}

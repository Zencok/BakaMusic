import { useState } from "react";
import useMounted from "@/hooks/useMounted";
import NoPlugin from "@/renderer/components/NoPlugin";
import SvgAsset from "@/renderer/components/SvgAsset";
import type { SvgAssetIconNames } from "@/renderer/components/SvgAsset";
import { hideModal } from "../..";
import Base from "../Base";
import "./index.scss";

interface IPluginInputPanelProps {
    variant: "play-music-by-id" | "import-music-sheet";
    title: string;
    description: string;
    iconName: SvgAssetIconNames;
    plugins: IPlugin.IPluginDelegate[];
    /** Preferred plugin hash when the panel opens; falls back to the first plugin. */
    initialPluginHash?: string | null;
    selectLabel: string;
    availablePluginText: string;
    selectedPluginLabel: string;
    inputLabel: string;
    placeholder: (plugin: IPlugin.IPluginDelegate) => string;
    hintTitle: string;
    hintMethod: string;
    hints: string[] | ((plugin: IPlugin.IPluginDelegate) => string[]);
    maxLength: number;
    cancelText: string;
    submitText: string;
    loadingText: string;
    errorText: string;
    emptySupportMethod: string;
    onSelectedPluginChange?: (plugin: IPlugin.IPluginDelegate) => void;
    onSubmit: (plugin: IPlugin.IPluginDelegate, input: string) => Promise<void>;
}

function resolveInitialPluginHash(
    plugins: IPlugin.IPluginDelegate[],
    preferredHash?: string | null,
) {
    if (preferredHash && plugins.some((plugin) => plugin.hash === preferredHash)) {
        return preferredHash;
    }
    return plugins[0]?.hash ?? "";
}

function platformInitial(platform: string) {
    const text = platform?.trim() || "?";
    return text.slice(0, 1).toLocaleUpperCase();
}

function resolveHints(
    plugin: IPlugin.IPluginDelegate,
    hintMethod: string,
    hints: IPluginInputPanelProps["hints"],
) {
    const commonHints = typeof hints === "function" ? hints(plugin) : hints;
    const pluginHints = plugin.hints?.[hintMethod] ?? [];

    return [...new Set([...commonHints, ...pluginHints]
        .map((hint) => hint?.trim())
        .filter((hint): hint is string => Boolean(hint)))];
}

export default function PluginInputPanel(props: IPluginInputPanelProps) {
    const {
        variant,
        title,
        description,
        iconName,
        plugins,
        initialPluginHash,
        selectLabel,
        availablePluginText,
        selectedPluginLabel,
        inputLabel,
        placeholder,
        hintTitle,
        hintMethod,
        hints,
        maxLength,
        cancelText,
        submitText,
        loadingText,
        errorText,
        emptySupportMethod,
        onSelectedPluginChange,
        onSubmit,
    } = props;
    const [selectedPluginHash, setSelectedPluginHash] = useState(() =>
        resolveInitialPluginHash(plugins, initialPluginHash),
    );
    const [inputText, setInputText] = useState("");
    const [loading, setLoading] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const isMounted = useMounted();
    const selectedPlugin = plugins.find((plugin) => plugin.hash === selectedPluginHash)
        ?? plugins[0];
    const normalizedInput = inputText.trim();
    const canSubmit = Boolean(selectedPlugin && normalizedInput && !loading);
    const visibleHints = selectedPlugin
        ? resolveHints(selectedPlugin, hintMethod, hints)
        : [];

    function selectPlugin(plugin: IPlugin.IPluginDelegate) {
        setSelectedPluginHash(plugin.hash);
        setSubmitError("");
        onSelectedPluginChange?.(plugin);
    }

    async function submit() {
        if (!selectedPlugin || !canSubmit) {
            return;
        }

        setLoading(true);
        setSubmitError("");
        try {
            // Persist the plugin used for a successful submit as well.
            onSelectedPluginChange?.(selectedPlugin);
            await onSubmit(selectedPlugin, normalizedInput);
        } catch {
            if (isMounted.current) {
                setSubmitError(errorText);
            }
        } finally {
            if (isMounted.current) {
                setLoading(false);
            }
        }
    }

    return (
        <Base withBlur={false} defaultClose>
            <div
                className={`modal--plugin-input-panel modal--${variant} shadow`}
                aria-busy={loading}
            >
                <Base.Header>{title}</Base.Header>
                {plugins.length ? (
                    <form
                        className="plugin-input-form"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void submit();
                        }}
                    >
                        <div className="plugin-input-body">
                            <div className="plugin-input-intro">
                                <span className="plugin-input-intro-icon" aria-hidden="true">
                                    <SvgAsset iconName={iconName}></SvgAsset>
                                </span>
                                <p>{description}</p>
                            </div>

                            <section className="plugin-input-section">
                                <div className="plugin-input-section-heading">
                                    <strong>{selectLabel}</strong>
                                    <span>{availablePluginText}</span>
                                </div>
                                <div
                                    aria-label={selectLabel}
                                    className="plugin-input-plugin-grid"
                                    role="group"
                                >
                                    {plugins.map((plugin) => {
                                        const selected = plugin.hash === selectedPlugin?.hash;
                                        return (
                                            <button
                                                aria-pressed={selected}
                                                className="plugin-input-plugin-option"
                                                disabled={loading}
                                                key={plugin.hash}
                                                type="button"
                                                onClick={() => {
                                                    selectPlugin(plugin);
                                                }}
                                            >
                                                <span
                                                    className="plugin-input-plugin-badge"
                                                    aria-hidden="true"
                                                >
                                                    {platformInitial(plugin.platform)}
                                                </span>
                                                <span className="plugin-input-plugin-name">
                                                    {plugin.platform}
                                                </span>
                                                <SvgAsset
                                                    iconName="check-circle"
                                                    size={18}
                                                ></SvgAsset>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>

                            <section className="plugin-input-section">
                                <div className="plugin-input-section-heading plugin-input-field-heading">
                                    <label htmlFor={`${variant}-input`}>{inputLabel}</label>
                                    <span className="plugin-input-selected-plugin">
                                        {selectedPluginLabel}
                                        <strong>{selectedPlugin?.platform}</strong>
                                    </span>
                                </div>
                                <div className="plugin-input-field">
                                    <SvgAsset iconName={iconName}></SvgAsset>
                                    <input
                                        aria-describedby={`${variant}-hints`}
                                        disabled={loading}
                                        id={`${variant}-input`}
                                        maxLength={maxLength}
                                        placeholder={selectedPlugin
                                            ? placeholder(selectedPlugin)
                                            : ""}
                                        spellCheck={false}
                                        value={inputText}
                                        onChange={(event) => {
                                            setInputText(event.target.value);
                                            setSubmitError("");
                                        }}
                                    ></input>
                                </div>
                            </section>

                            <aside
                                className="plugin-input-hints"
                                id={`${variant}-hints`}
                            >
                                <div className="plugin-input-hints-title">
                                    <SvgAsset iconName="question-mark-circle"></SvgAsset>
                                    <strong>{hintTitle}</strong>
                                </div>
                                <ul>
                                    {visibleHints.map((hint) => (
                                        <li key={hint}>{hint}</li>
                                    ))}
                                </ul>
                            </aside>

                            {submitError ? (
                                <div className="plugin-input-error" role="alert">
                                    <SvgAsset iconName="x-mark"></SvgAsset>
                                    <span>{submitError}</span>
                                </div>
                            ) : null}
                        </div>

                        <div className="plugin-input-footer">
                            <button
                                className="plugin-input-button"
                                disabled={loading}
                                type="button"
                                onClick={hideModal}
                            >
                                {cancelText}
                            </button>
                            <button
                                className="plugin-input-button plugin-input-button-primary"
                                disabled={!canSubmit}
                                type="submit"
                            >
                                {loading ? (
                                    <span
                                        className="plugin-input-spinner"
                                        aria-hidden="true"
                                    ></span>
                                ) : (
                                    <SvgAsset iconName={iconName}></SvgAsset>
                                )}
                                <span>{loading ? loadingText : submitText}</span>
                            </button>
                        </div>
                    </form>
                ) : (
                    <div className="plugin-input-empty">
                        <NoPlugin supportMethod={emptySupportMethod}></NoPlugin>
                    </div>
                )}
            </div>
        </Base>
    );
}

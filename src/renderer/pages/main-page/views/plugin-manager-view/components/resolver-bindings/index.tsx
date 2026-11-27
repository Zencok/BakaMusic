import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "react-toastify";
import useAppConfig from "@/hooks/useAppConfig";
import PluginManager, { usePluginRegistryState } from "@shared/plugin-manager/renderer";
import "./index.scss";

export default function ResolverBindings({ plugins }: { plugins: IPlugin.IPluginDelegate[] }) {
    const { t } = useTranslation();
    const { resolverBindings, retiredPlugins } = usePluginRegistryState();
    const meta = useAppConfig("private.pluginMeta") ?? {};
    const [saving, setSaving] = useState<string | null>(null);
    const providers = plugins.filter((plugin) => plugin.kind === "provider");
    return <>
        <section className="plugin-manager-section resolver-bindings">
            <div className="plugin-manager-section-header"><div><h2>{t("plugin_management_page.playback_bindings")}</h2><p>{t("plugin_management_page.playback_bindings_description")}</p></div></div>
            <div className="plugin-manager-list-surface">
                {providers.map((provider) => {
                    const selected = resolverBindings.find((binding) => binding.providerId === provider.id)?.resolverId ?? "";
                    const resolvers = plugins.filter((plugin) => plugin.kind === "resolver" && plugin.sources?.includes(provider.sourceId ?? "") && !meta[plugin.id]?.disabled && provider.capabilities.includes("media.prepare"));
                    return <label className="resolver-binding-row" key={provider.id}>
                        <span>{provider.name}</span>
                        <select aria-label={t("plugin_management_page.playback_binding_for", { name: provider.name })} value={selected} disabled={saving !== null || meta[provider.id]?.disabled} onChange={async (event) => {
                            const resolverId = event.currentTarget.value || null;
                            setSaving(provider.id);
                            try {
                                await PluginManager.setResolverBinding(provider.id, resolverId);
                            } catch {
                                toast.error(t("plugin_management_page.binding_failed"));
                            } finally {
                                setSaving(null);
                            }
                        }}>
                            <option value="">{t("plugin_management_page.provider_playback")}</option>
                            {selected && !resolvers.some((resolver) => resolver.id === selected) ? <option value={selected} disabled>{t("plugin_management_page.binding_unavailable")}</option> : null}
                            {resolvers.map((resolver) => <option key={resolver.id} value={resolver.id}>{resolver.name}</option>)}
                        </select>
                    </label>;
                })}
            </div>
        </section>
        {retiredPlugins.length ? <section className="plugin-manager-section">
            <div className="plugin-manager-section-header"><div><h2>{t("plugin_management_page.stopped_plugins")}</h2><p>{t("plugin_management_page.stopped_plugins_description")}</p></div></div>
            <ul className="plugin-manager-list-surface stopped-plugin-list">{retiredPlugins.map((plugin) => <li key={plugin.id + plugin.path}><span>{plugin.name}</span><span>{t("plugin_management_page.stopped")}</span></li>)}</ul>
        </section> : null}
    </>;
}

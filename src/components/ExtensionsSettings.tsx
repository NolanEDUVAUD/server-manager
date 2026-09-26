import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, Copy, Download, FileJson, Link2, Package, Trash2 } from "lucide-react";
import { useT } from "../i18n";
import { useToast } from "../hooks/useToast";
import { ConfirmDialog } from "./ConfirmDialog";
import { ToastContainer } from "./Toast";
import {
  contributionCount,
  ExtensionManifest,
  InstalledExtension,
  parseAndValidateManifest,
} from "../utils/extensions";

const button =
  "flex items-center gap-2 px-3 py-2 text-sm bg-bg-active text-text-primary rounded-win hover:bg-bg-hover transition-colors duration-150 disabled:opacity-50";
const primary =
  "flex items-center gap-2 px-4 py-2 text-sm bg-accent-primary text-white rounded-win hover:bg-accent-secondary transition-colors duration-150 disabled:opacity-50";
const input =
  "w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent-primary transition-colors duration-150";

/** Paramètres → Extensions : extensions communautaires (manifeste JSON déclaratif) */
export function ExtensionsSettings() {
  const { t } = useT();
  const { toasts, removeToast, success, error } = useToast();
  const [installed, setInstalled] = useState<InstalledExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [installing, setInstalling] = useState(false);
  const [manifestErrors, setManifestErrors] = useState<string[]>([]);
  const [toUninstall, setToUninstall] = useState<ExtensionManifest | null>(null);

  const reload = async () => {
    try {
      setInstalled(await invoke<InstalledExtension[]>("get_extensions"));
    } catch (e) {
      error(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const install = async (raw: string) => {
    setManifestErrors([]);
    const result = parseAndValidateManifest(raw);
    if (!result.ok) {
      setManifestErrors(result.errors);
      return;
    }
    setInstalling(true);
    try {
      await invoke("install_extension", { manifest: result.manifest });
      success(t("extensions.installed", { name: result.manifest.name }));
      setUrl("");
      await reload();
    } catch (e) {
      error(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const installFromFile = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "Extension", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    setInstalling(true);
    try {
      const raw = await invoke<string>("read_extension_file", { path });
      await install(raw);
    } catch (e) {
      error(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const installFromUrl = async () => {
    const trimmed = url.trim();
    if (!trimmed.toLowerCase().startsWith("https://")) {
      setManifestErrors([t("extensions.httpsOnly")]);
      return;
    }
    setInstalling(true);
    try {
      const raw = await invoke<string>("fetch_extension_manifest", { url: trimmed });
      await install(raw);
    } catch (e) {
      error(String(e));
    } finally {
      setInstalling(false);
    }
  };

  const toggle = async (ext: InstalledExtension) => {
    try {
      await invoke("set_extension_enabled", { id: ext.manifest.id, enabled: !ext.enabled });
      await reload();
    } catch (e) {
      error(String(e));
    }
  };

  const uninstall = async () => {
    if (!toUninstall) return;
    try {
      await invoke("uninstall_extension", { id: toUninstall.id });
      setToUninstall(null);
      success(t("extensions.uninstalled"));
      await reload();
    } catch (e) {
      error(String(e));
    }
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    success(t("extensions.linkCopied"));
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-text-primary font-medium text-base">{t("settingsPage.sections.extensions")}</h2>
      <p className="text-text-secondary text-sm">{t("extensions.intro")}</p>

      <div className="flex items-start gap-2 p-3 rounded-win bg-accent-warning/10 border border-accent-warning/30">
        <AlertTriangle size={16} className="text-accent-warning shrink-0 mt-0.5" />
        <p className="text-xs text-text-secondary">{t("extensions.warning")}</p>
      </div>

      {/* ── Liste des extensions installées ─────────────────────────────── */}
      <div className="bg-bg-tertiary rounded-win p-4 card space-y-3">
        <h3 className="flex items-center gap-2 text-text-primary font-medium text-sm">
          <Package size={15} className="text-accent-primary" /> {t("extensions.installedTitle")}
        </h3>
        {loading ? (
          <p className="text-xs text-text-muted">{t("common.loading")}</p>
        ) : installed.length === 0 ? (
          <p className="text-xs text-text-muted">{t("extensions.none")}</p>
        ) : (
          <ul className="space-y-2">
            {installed.map((ext) => {
              const m = ext.manifest;
              return (
                <li key={m.id} className="border border-border-primary rounded-win p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-text-primary font-medium truncate">
                        {m.name} <span className="text-text-muted font-normal">{t("extensions.version", { version: m.version })}</span>
                      </p>
                      <p className="text-xs text-text-muted truncate">{t("extensions.by", { author: m.author })} · {m.id}</p>
                      <p className="text-xs text-text-secondary mt-1">{m.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => toggle(ext)}
                        className={ext.enabled ? button : primary}
                        title={ext.enabled ? t("extensions.disable") : t("extensions.enable")}
                      >
                        {ext.enabled ? t("extensions.disable") : t("extensions.enable")}
                      </button>
                      <button
                        onClick={() => setToUninstall(m)}
                        className="p-2 rounded-win bg-bg-active hover:bg-bg-hover text-accent-error"
                        title={t("extensions.uninstall")}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    <span>{t("extensions.contributes", { count: contributionCount(m) })}</span>
                    {m.homepage && (
                      <a href="#" onClick={(e) => { e.preventDefault(); copyLink(m.homepage!); }} className="text-accent-primary hover:underline" title={m.homepage}>
                        {t("extensions.homepage")}
                      </a>
                    )}
                  </div>
                  {!!m.contributes?.webLinks?.length && (
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border-secondary">
                      {m.contributes.webLinks.map((l) => (
                        <button
                          key={l.url}
                          onClick={() => copyLink(l.url)}
                          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-bg-active hover:bg-bg-hover text-text-secondary"
                          title={l.url}
                        >
                          <Link2 size={10} /> {l.name} <Copy size={10} />
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {manifestErrors.length > 0 && (
        <div className="bg-bg-tertiary rounded-win p-4 card space-y-1 border border-accent-error/40">
          <p className="text-sm text-accent-error font-medium">{t("extensions.invalidTitle")}</p>
          <ul className="text-xs text-text-secondary list-disc pl-4 space-y-0.5">
            {manifestErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {/* ── Installer depuis un fichier ─────────────────────────────────── */}
      <div className="bg-bg-tertiary rounded-win p-4 card space-y-2">
        <h3 className="flex items-center gap-2 text-text-primary font-medium text-sm">
          <FileJson size={15} className="text-accent-primary" /> {t("extensions.installFromFile")}
        </h3>
        <p className="text-xs text-text-secondary">{t("extensions.installFromFileHint")}</p>
        <button onClick={installFromFile} disabled={installing} className={button}>
          {installing ? t("extensions.installing") : t("extensions.chooseFile")}
        </button>
      </div>

      {/* ── Installer depuis une URL ─────────────────────────────────────── */}
      <div className="bg-bg-tertiary rounded-win p-4 card space-y-2">
        <h3 className="flex items-center gap-2 text-text-primary font-medium text-sm">
          <Download size={15} className="text-accent-primary" /> {t("extensions.installFromUrl")}
        </h3>
        <p className="text-xs text-text-secondary">{t("extensions.installFromUrlHint")}</p>
        <div className="flex gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("extensions.urlPlaceholder")} className={input} />
          <button onClick={installFromUrl} disabled={installing || url.trim() === ""} className={primary}>
            {installing ? t("extensions.installing") : t("extensions.install")}
          </button>
        </div>
      </div>

      {toUninstall && (
        <ConfirmDialog
          title={t("extensions.uninstallConfirmTitle")}
          message={t("extensions.uninstallConfirmMessage", { name: toUninstall.name })}
          confirmLabel={t("extensions.uninstall")}
          dangerous
          onConfirm={uninstall}
          onCancel={() => setToUninstall(null)}
        />
      )}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}

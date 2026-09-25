import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertTriangle, ArchiveRestore, FolderOpen, Save, ShieldCheck } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useToast } from "../hooks/useToast";
import { useT } from "../i18n";
import { BackupConfig, BackupConfigView, BackupSummary } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ToastContainer } from "./Toast";
import { cn } from "../utils";

/** Même règle que le backend (backup::validate_passphrase) */
export const MIN_PASSPHRASE = 12;

/** Problème d'une phrase de passe saisie (confirmation facultative), ou null */
export function passphraseIssue(passphrase: string, confirm?: string): "short" | "mismatch" | null {
  if ([...passphrase].length < MIN_PASSPHRASE) return "short";
  if (confirm !== undefined && confirm !== passphrase) return "mismatch";
  return null;
}

const input =
  "w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent-primary transition-colors duration-150";
const button =
  "flex items-center gap-2 px-3 py-2 text-sm bg-bg-active text-text-primary rounded-win hover:bg-bg-hover transition-colors duration-150 disabled:opacity-50";
const primary =
  "flex items-center gap-2 px-4 py-2 text-sm bg-accent-primary text-white rounded-win hover:bg-accent-secondary transition-colors duration-150 disabled:opacity-50";

/** Paramètres → Configuration : sauvegarde chiffrée, restauration, sauvegarde automatique */
export function BackupPanel() {
  const { t, locale } = useT();
  const { toasts, removeToast, success, error } = useToast();

  // ── Export ──────────────────────────────────────────────────────────────
  const [exportPass, setExportPass] = useState("");
  const [exportConfirm, setExportConfirm] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportIssue = passphraseIssue(exportPass, exportConfirm);

  const doExport = async () => {
    setExporting(true);
    try {
      const path = await invoke<string>("backup_export", { passphrase: exportPass });
      setExportPass("");
      setExportConfirm("");
      success(t("backup.export.done", { path }));
    } catch (e) {
      // Boîte de dialogue fermée : pas une erreur à signaler
      if (!String(e).includes("annulé")) error(String(e));
    } finally {
      setExporting(false);
    }
  };

  // ── Restauration ────────────────────────────────────────────────────────
  const [restorePass, setRestorePass] = useState("");
  const [reading, setReading] = useState(false);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const inspect = async () => {
    setReading(true);
    try {
      setSummary(await invoke<BackupSummary>("backup_inspect", { passphrase: restorePass }));
    } catch (e) {
      if (!String(e).includes("annulée")) error(String(e));
    } finally {
      setReading(false);
    }
  };

  const cancelRestore = () => {
    setSummary(null);
    invoke("backup_cancel").catch(() => {});
  };

  const applyRestore = async () => {
    setConfirmRestore(false);
    try {
      await invoke("backup_apply");
      setSummary(null);
      setRestorePass("");
      // Tout recharger : serveurs, groupes, paramètres…
      useStore.setState({ initialized: false });
      await useStore.getState().initialize();
      success(t("backup.restore.done"));
    } catch (e) {
      error(String(e));
    }
  };

  // ── Sauvegarde automatique ──────────────────────────────────────────────
  const [auto, setAuto] = useState<BackupConfigView | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoPass, setAutoPass] = useState("");
  const [savingAuto, setSavingAuto] = useState(false);
  const [running, setRunning] = useState(false);

  const loadAuto = async () => {
    try {
      setAuto(await invoke<BackupConfigView>("get_backup_settings"));
      setAutoError(null);
    } catch (e) {
      setAutoError(String(e));
    }
  };

  useEffect(() => {
    loadAuto();
  }, []);

  const patchAuto = (patch: Partial<BackupConfig>) => setAuto((a) => (a ? { ...a, ...patch } : a));
  // Phrase requise à l'activation si aucune n'est enregistrée ; sinon facultative
  const autoPassIssue =
    auto?.enabled && (autoPass !== "" || !auto.has_passphrase) ? passphraseIssue(autoPass) : null;

  const browse = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") patchAuto({ folder: selected });
  };

  const saveAuto = async () => {
    if (!auto) return;
    setSavingAuto(true);
    try {
      const { has_passphrase: _ignored, ...config } = auto;
      const saved = await invoke<BackupConfigView>("save_backup_settings", {
        config,
        passphrase: autoPass === "" ? null : autoPass,
      });
      setAuto(saved);
      setAutoPass("");
      success(t("backup.auto.saved"));
    } catch (e) {
      error(String(e));
    } finally {
      setSavingAuto(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const path = await invoke<string>("backup_run_now");
      success(t("backup.auto.ran", { path }));
    } catch (e) {
      error(String(e));
    } finally {
      setRunning(false);
      loadAuto();
    }
  };

  const issueText = (issue: "short" | "mismatch" | null) =>
    issue === "short" ? t("backup.tooShort", { min: MIN_PASSPHRASE }) : issue === "mismatch" ? t("backup.mismatch") : null;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="flex items-center gap-2 text-text-primary font-medium text-sm">
          <ShieldCheck size={15} className="text-accent-primary" /> {t("backup.title")}
        </h3>
        <p className="text-text-secondary text-xs mt-1">{t("backup.intro")}</p>
      </div>

      {/* ── Export ─────────────────────────────────────────────────────── */}
      <div className="bg-bg-tertiary rounded-win p-4 card space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="backup-pass" className="text-text-secondary text-xs block mb-1">{t("backup.passphrase")}</label>
            <input id="backup-pass" type="password" autoComplete="new-password" value={exportPass} onChange={(e) => setExportPass(e.target.value)} className={input} />
          </div>
          <div>
            <label htmlFor="backup-pass-confirm" className="text-text-secondary text-xs block mb-1">{t("backup.passphraseConfirm")}</label>
            <input id="backup-pass-confirm" type="password" autoComplete="new-password" value={exportConfirm} onChange={(e) => setExportConfirm(e.target.value)} className={input} />
          </div>
        </div>
        <p className={cn("text-xs", exportPass && exportIssue ? "text-accent-warning" : "text-text-muted")}>
          {exportPass && exportIssue ? issueText(exportIssue) : t("backup.passphraseHint", { min: MIN_PASSPHRASE })}
        </p>
        <button onClick={doExport} disabled={!!exportIssue || exporting} className={primary}>
          <Save size={14} /> {exporting ? t("backup.export.running") : t("backup.export.button")}
        </button>
      </div>

      {/* ── Restauration ───────────────────────────────────────────────── */}
      <div className="bg-bg-tertiary rounded-win p-4 card space-y-3">
        <p className="text-text-primary text-sm">{t("backup.restore.title")}</p>
        {summary ? (
          <div className="space-y-3">
            <div className="text-xs space-y-1">
              <p className="text-text-primary font-medium">
                {t("backup.restore.summaryTitle", {
                  date: new Date(summary.created_at).toLocaleString(locale),
                  version: summary.app_version,
                })}
              </p>
              <p className="text-text-secondary">
                {t("backup.restore.summary", {
                  servers: summary.servers,
                  groups: summary.groups,
                  probes: summary.probes,
                  proxmox: summary.proxmox_connections,
                  integrations: summary.integrations,
                  schedules: summary.schedules,
                })}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmRestore(true)} className={primary}>
                <ArchiveRestore size={14} /> {t("backup.restore.apply")}
              </button>
              <button onClick={cancelRestore} className={button}>{t("common.cancel")}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1">
              <label htmlFor="restore-pass" className="text-text-secondary text-xs block mb-1">{t("backup.passphrase")}</label>
              <input id="restore-pass" type="password" autoComplete="off" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} className={input} />
            </div>
            <button onClick={inspect} disabled={restorePass === "" || reading} className={button}>
              <ArchiveRestore size={14} /> {reading ? t("backup.restore.reading") : t("backup.restore.choose")}
            </button>
          </div>
        )}
      </div>

      {/* ── Sauvegarde automatique ─────────────────────────────────────── */}
      <div className="bg-bg-tertiary rounded-win p-4 card space-y-3">
        <p className="text-text-primary text-sm">{t("backup.auto.title")}</p>
        {autoError ? (
          <p className="text-xs text-accent-error">{t("common.errorPrefix", { message: autoError })}</p>
        ) : !auto ? (
          <p className="text-xs text-text-muted">{t("common.loading")}</p>
        ) : (
          <>
            <label className="flex items-start gap-2 text-sm text-text-primary">
              <input type="checkbox" checked={auto.enabled} onChange={(e) => patchAuto({ enabled: e.target.checked })} className="mt-1" />
              <span>
                {t("backup.auto.enable")}
                <span className="block text-xs text-text-muted">{t("backup.auto.enableHelp")}</span>
              </span>
            </label>
            {auto.enabled && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="backup-folder" className="text-text-secondary text-xs block mb-1">{t("backup.auto.folder")}</label>
                  <div className="flex gap-2">
                    <input id="backup-folder" value={auto.folder} onChange={(e) => patchAuto({ folder: e.target.value })} className={input} />
                    <button onClick={browse} className={button} aria-label={t("backup.auto.browse")}>
                      <FolderOpen size={14} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="backup-frequency" className="text-text-secondary text-xs block mb-1">{t("backup.auto.frequency")}</label>
                    <select id="backup-frequency" value={auto.frequency} onChange={(e) => patchAuto({ frequency: e.target.value as BackupConfig["frequency"] })} className={input}>
                      <option value="Daily">{t("backup.auto.daily")}</option>
                      <option value="Weekly">{t("backup.auto.weekly")}</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="backup-keep" className="text-text-secondary text-xs block mb-1">{t("backup.auto.keep")}</label>
                    <input id="backup-keep" type="number" min={1} max={100} value={auto.keep} onChange={(e) => patchAuto({ keep: Number(e.target.value) })} className={input} />
                  </div>
                </div>
                <div>
                  <label htmlFor="backup-auto-pass" className="text-text-secondary text-xs block mb-1">{t("backup.passphrase")}</label>
                  <input
                    id="backup-auto-pass"
                    type="password"
                    autoComplete="new-password"
                    value={autoPass}
                    placeholder={auto.has_passphrase ? t("backup.auto.passphraseStored") : ""}
                    onChange={(e) => setAutoPass(e.target.value)}
                    className={input}
                  />
                  {autoPassIssue && <p className="text-xs text-accent-warning mt-1">{issueText(autoPassIssue)}</p>}
                </div>
                <p className="text-xs text-text-muted">{t("backup.auto.lockedNote")}</p>
              </div>
            )}
            {auto.last_error && (
              <p className="flex items-start gap-1.5 text-xs text-accent-error">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {t("backup.auto.lastError", { message: auto.last_error })}
              </p>
            )}
            <p className="text-xs text-text-muted">
              {auto.last_run ? t("backup.auto.lastRun", { date: new Date(auto.last_run).toLocaleString(locale) }) : t("backup.auto.never")}
            </p>
            <div className="flex gap-2">
              <button onClick={saveAuto} disabled={savingAuto || !!autoPassIssue || (auto.enabled && !auto.folder.trim())} className={primary}>
                {savingAuto ? t("common.saving") : t("backup.auto.save")}
              </button>
              {auto.enabled && auto.has_passphrase && (
                <button onClick={runNow} disabled={running} className={button}>
                  <Save size={14} /> {running ? t("backup.auto.running") : t("backup.auto.runNow")}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {confirmRestore && (
        <ConfirmDialog
          title={t("backup.restore.confirmTitle")}
          message={t("backup.restore.confirmMessage")}
          confirmLabel={t("backup.restore.apply")}
          dangerous
          onConfirm={applyRestore}
          onCancel={() => setConfirmRestore(false)}
        />
      )}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}

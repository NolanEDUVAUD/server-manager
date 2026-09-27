import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle, CheckCircle2, Loader2, MinusCircle, Play, Save, Trash2, XCircle, BookOpen, RefreshCw,
  MessageSquareWarning, CornerDownLeft, Sparkles, Search, WifiOff, RotateCcw, Terminal, Wrench, Info,
} from "lucide-react";
import { useStore } from "../stores/useStore";
import { AnsibleConfig, BatchMode, BatchTask, BatchUpdate, SmartAction, SmartPreview, SmartSource, TargetOsView } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { detectPrompt, looksModifying, TEMPLATES } from "../utils/batch";
import { usePersistentState } from "../hooks/usePersistentState";
import { cn } from "../utils";
import { useT, TKey } from "../i18n";

/** Pré-remplissage depuis une autre page (ex. Mises à jour) : rien n'est lancé sans confirmation */
export interface BatchPrefill {
  script: string;
  serverIds: string[];
}

type ServerRun = { status: "pending" | "running" | "ok" | "failed" | "skipped"; output: string; detail?: string; ms?: number };

/** Étape 2 « Quoi exécuter » : les trois façons de définir ce qui sera lancé */
type WhatMode = "action" | "script" | "ansible";

const inputClass = "w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary";

const SMART_ACTION_TYPES = ["UpdatePackages", "UpgradeSystem", "InstallPackage", "RestartService", "CleanPackageCache", "RebootIfRequired"] as const;

/** Variables de gabarit toujours reconnues dans le script, avec un exemple insérable en un clic */
const TEMPLATE_VARS: { labelKey: TKey; snippet: string }[] = [
  { labelKey: "batch.what.variables.pkgUpdate", snippet: "{{pkg_update}}" },
  { labelKey: "batch.what.variables.pkgUpgrade", snippet: "{{pkg_upgrade}}" },
  { labelKey: "batch.what.variables.pkgInstall", snippet: "{{pkg_install nginx}}" },
  { labelKey: "batch.what.variables.pkgClean", snippet: "{{pkg_clean}}" },
  { labelKey: "batch.what.variables.serviceRestart", snippet: "{{service_restart nginx}}" },
  { labelKey: "batch.what.variables.rebootIfRequired", snippet: "{{reboot_if_required}}" },
  { labelKey: "batch.what.variables.osId", snippet: "{{os_id}}" },
  { labelKey: "batch.what.variables.osVersion", snippet: "{{os_version}}" },
  { labelKey: "batch.what.variables.ifBlock", snippet: "{{#if debian}}\n\n{{/if}}" },
];

/** Sortie d'un serveur ; tant que la commande tourne, on peut répondre à ses questions */
function ServerRunCard({ name, run, single, onSend }: { name: string; run: ServerRun; single: boolean; onSend?: (text: string) => Promise<void> }) {
  const { t } = useT();
  const [answer, setAnswer] = useState("");
  const pre = useRef<HTMLPreElement>(null);
  const running = run.status === "running";
  const prompt = running ? detectPrompt(run.output) : null;

  // Suit la fin de la sortie, comme un terminal
  useEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [run.output]);

  async function send(text: string) {
    if (!onSend) return;
    await onSend(text);
    setAnswer("");
  }

  return (
    <details open={run.status === "failed" || single || !!prompt} className={cn("bg-bg-tertiary border rounded-win", prompt ? "border-accent-warning" : "border-border-primary")}>
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer text-sm">
        {prompt ? <MessageSquareWarning size={13} className="text-accent-warning" />
          : running || run.status === "pending" ? <Loader2 size={13} className="animate-spin text-accent-primary" />
          : run.status === "ok" ? <CheckCircle2 size={13} className="text-accent-success" />
          : run.status === "skipped" ? <MinusCircle size={13} className="text-text-muted" />
          : <XCircle size={13} className="text-accent-error" />}
        <span className="text-text-primary">{name}</span>
        {prompt && <span className="text-xs text-accent-warning">{t("batch.run.waiting")}</span>}
        <span className="text-xs text-text-muted ml-auto">{run.detail}{run.ms !== undefined && ` · ${(run.ms / 1000).toFixed(1)} s`}</span>
      </summary>
      <pre ref={pre} className="px-3 pb-3 text-[11px] font-mono text-text-secondary whitespace-pre-wrap break-all max-h-72 overflow-y-auto select-text">{run.output || t("batch.run.noOutput")}</pre>
      {running && onSend && (
        <div className="px-3 pb-3 space-y-2">
          {prompt && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="text-accent-warning">{prompt.question}</span>
              {prompt.choices.map((c) => (
                <button key={c.label} onClick={() => send(c.send)} title={c.hint} className="px-2.5 py-1 rounded-win border border-accent-warning/50 text-text-primary hover:bg-bg-hover">
                  {c.label}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); send(answer + "\n"); }} className="flex items-center gap-2">
            <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={t("batch.run.answerPlaceholder")} aria-label={t("batch.run.answerFor", { name })} className="flex-1 bg-bg-input border border-border-primary rounded-win px-3 py-1.5 text-xs font-mono text-text-primary focus:outline-none focus:border-accent-primary" />
            <button type="submit" className="p-1.5 rounded-win border border-border-primary text-text-secondary hover:text-accent-primary" title={t("batch.run.send")}><CornerDownLeft size={13} /></button>
            <button type="button" onClick={() => send("\x03")} className="px-2 py-1 rounded-win border border-border-primary text-xs text-text-secondary hover:text-accent-error" title={t("batch.run.interrupt")}>Ctrl+C</button>
          </form>
        </div>
      )}
    </details>
  );
}

/** Sortie par serveur d'une exécution (lot ou playbook) */
function RunOutput({ runs, names, onSend }: { runs: Record<string, ServerRun>; names: Record<string, string>; onSend: (serverId: string, text: string) => Promise<void> }) {
  const ids = Object.keys(runs);
  return (
    <div className="space-y-2">
      {ids.map((id) => (
        <ServerRunCard key={id} name={names[id] ?? id} run={runs[id]} single={ids.length === 1} onSend={(text) => onSend(id, text)} />
      ))}
    </div>
  );
}

export function Batch() {
  const { t } = useT();
  const { servers, groups, statuses } = useStore();
  const { toasts, removeToast, success, error } = useToast();
  const prefill = useLocation().state as BatchPrefill | null;

  // ── Étape 1 : cibles ────────────────────────────────────────────────────
  const [selected, setSelected] = usePersistentState<Set<string>>("batch.selected", new Set(prefill?.serverIds ?? []));
  const [search, setSearch] = useState("");
  const [osByServer, setOsByServer] = useState<Record<string, TargetOsView>>({});
  const [osLoading, setOsLoading] = useState<Set<string>>(new Set());
  const autoDetected = useRef<Set<string>>(new Set());

  // ── Étape 2 : quoi exécuter ─────────────────────────────────────────────
  const [what, setWhat] = usePersistentState<WhatMode>("batch.what", "action");
  const [script, setScript] = usePersistentState("batch.script", prefill?.script ?? "");
  const [smartActionType, setSmartActionType] = useState<SmartAction["type"]>("UpdatePackages");
  const [smartName, setSmartName] = useState("");
  const scriptRef = useRef<HTMLTextAreaElement>(null);

  // Un préremplissage explicite (venu d'une autre page via la navigation) prime toujours
  // sur un brouillon précédent de cette même page.
  useEffect(() => {
    if (prefill?.script !== undefined) { setScript(prefill.script); setWhat("script"); }
    if (prefill?.serverIds) setSelected(new Set(prefill.serverIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Étape 3 : options & lancement ───────────────────────────────────────
  const [mode, setMode] = useState<BatchMode>("Parallel");
  const [stopOnError, setStopOnError] = useState(false);
  const [preview, setPreview] = useState<SmartPreview[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmingPreview, setConfirmingPreview] = useState(false);

  // Tâches enregistrées
  const [tasks, setTasks] = useState<BatchTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState("");

  // Ansible
  const [ansible, setAnsible] = useState<AnsibleConfig>({ server_id: "", dir: "/etc/ansible" });
  const [ansibleConfigured, setAnsibleConfigured] = useState(false);
  const [playbooks, setPlaybooks] = useState<string[] | null>(null);
  const [playbook, setPlaybook] = useState("");
  const [check, setCheck] = useState(true);
  const [limit, setLimit] = useState("");
  const [confirmAnsible, setConfirmAnsible] = useState(false);

  // Résultats
  const [runs, setRuns] = useState<Record<string, ServerRun>>({});
  const runId = useRef<string | null>(null);
  /** Source de la dernière exécution « cibles » (script ou action), pour « Relancer sur les échecs » */
  const lastRun = useRef<{ source: SmartSource } | null>(null);

  useEffect(() => {
    invoke<BatchTask[]>("get_batch_tasks").then(setTasks).catch(() => {});
    invoke<AnsibleConfig | null>("get_ansible_config").then((c) => { if (c) { setAnsible(c); setAnsibleConfigured(true); } }).catch(() => {});
    const un = listen<BatchUpdate>("batch-update", (e) => {
      const u = e.payload;
      if (u.run_id !== runId.current) return;
      if (u.type === "Done") return;
      setRuns((prev) => {
        const cur = prev[u.server_id] ?? { status: "pending", output: "" };
        switch (u.type) {
          case "Started": return { ...prev, [u.server_id]: { ...cur, status: "running" } };
          case "Output": return { ...prev, [u.server_id]: { ...cur, output: cur.output + u.chunk } };
          case "Finished": return { ...prev, [u.server_id]: { ...cur, status: u.ok ? "ok" : "failed", detail: u.detail, ms: u.duration_ms } };
          case "Skipped": return { ...prev, [u.server_id]: { ...cur, status: "skipped", detail: u.reason } };
        }
      });
    });
    return () => { un.then((f) => f()); };
  }, []);

  const names = Object.fromEntries(servers.map((s) => [s.id, s.name]));
  const modifying = what === "script" && looksModifying(script);

  const filteredServers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter((s) => s.name.toLowerCase().includes(q) || s.ip.toLowerCase().includes(q));
  }, [servers, search]);

  function toggle(id: string) {
    setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAll() { setSelected(new Set(servers.map((s) => s.id))); }
  function selectNone() { setSelected(new Set()); }
  function addGroup(ids: string[]) { setSelected((p) => new Set([...p, ...ids])); }

  async function detectOs(ids: string[], force: boolean) {
    if (ids.length === 0) return;
    ids.forEach((id) => autoDetected.current.add(id));
    setOsLoading((p) => new Set([...p, ...ids]));
    try {
      const views = await invoke<TargetOsView[]>("smart_batch_detect_os", { serverIds: ids, force });
      setOsByServer((prev) => ({ ...prev, ...Object.fromEntries(views.map((v) => [v.server_id, v])) }));
    } catch (e) {
      error(String(e));
    } finally {
      setOsLoading((p) => { const n = new Set(p); ids.forEach((id) => n.delete(id)); return n; });
    }
  }

  // Détection automatique (débouncée) de l'OS de toute nouvelle cible sélectionnée
  useEffect(() => {
    const toDetect = [...selected].filter((id) => !autoDetected.current.has(id));
    if (toDetect.length === 0) return;
    const timer = setTimeout(() => detectOs(toDetect, false), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  function currentSmartAction(): SmartAction | null {
    if (what !== "action") return null;
    return smartActionType === "InstallPackage" || smartActionType === "RestartService"
      ? ({ type: smartActionType, name: smartName.trim() } as SmartAction)
      : ({ type: smartActionType } as SmartAction);
  }

  function currentSource(): SmartSource {
    const action = currentSmartAction();
    return action ? { type: "Action", value: action } : { type: "Script", value: script };
  }

  const missingSmartName = what === "action" && (smartActionType === "InstallPackage" || smartActionType === "RestartService") && !smartName.trim();
  const hasWhat = what === "action" ? !missingSmartName : what === "script" ? script.trim().length > 0 : !!playbook;
  const launchDisabled = what === "ansible" ? !playbook : selected.size === 0 || !hasWhat || previewLoading;

  function insertVariable(snippet: string) {
    const el = scriptRef.current;
    const start = el?.selectionStart ?? script.length;
    const end = el?.selectionEnd ?? script.length;
    const next = script.slice(0, start) + snippet + script.slice(end);
    setScript(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = start + snippet.length;
    });
  }

  async function openPreview() {
    if (what === "ansible") { setConfirmAnsible(true); return; }
    if (selected.size === 0) return;
    setPreviewLoading(true);
    setPreview(null);
    try {
      const source = currentSource();
      const items = await invoke<SmartPreview[]>("smart_batch_preview", { serverIds: [...selected], source });
      setPreview(items);
      lastRun.current = { source };
      setConfirmingPreview(true);
    } catch (e) {
      error(String(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function launch() {
    setConfirmingPreview(false);
    if (!lastRun.current) return;
    const ids = [...selected];
    setRuns(Object.fromEntries(ids.map((id) => [id, { status: "pending", output: "" } as ServerRun])));
    try {
      runId.current = await invoke<string>("smart_batch_run", { serverIds: ids, source: lastRun.current.source, mode, stopOnError });
    } catch (e) {
      error(String(e));
    }
  }

  async function launchAnsible() {
    setRuns((prev) => ({ ...prev, [ansible.server_id]: { status: "pending", output: "" } }));
    try {
      runId.current = await invoke<string>("ansible_run", { playbook, check, limit: limit || null });
    } catch (e) {
      error(String(e));
    }
  }

  function confirmRunPlaybook() {
    setConfirmAnsible(false);
    lastRun.current = null;
    void launchAnsible();
  }

  /** Relance uniquement les cibles en échec, avec la même source ; pour Ansible (un seul hôte), relance simplement le playbook */
  async function relaunchFailed() {
    const failedIds = Object.entries(runs).filter(([, r]) => r.status === "failed").map(([id]) => id);
    if (failedIds.length === 0) return;
    if (lastRun.current) {
      setRuns((prev) => ({ ...prev, ...Object.fromEntries(failedIds.map((id) => [id, { status: "pending", output: "" } as ServerRun])) }));
      try {
        runId.current = await invoke<string>("smart_batch_run", { serverIds: failedIds, source: lastRun.current.source, mode, stopOnError });
      } catch (e) {
        error(String(e));
      }
    } else {
      await launchAnsible();
    }
  }

  /** Réponse à une question posée pendant l'exécution */
  async function sendInput(serverId: string, text: string) {
    if (!runId.current) return;
    try {
      await invoke("batch_send_input", { runId: runId.current, serverId, text });
    } catch (e) {
      error(String(e));
    }
  }

  async function saveTask() {
    const name = window.prompt(t("batch.taskNamePrompt"));
    if (!name) return;
    const action = currentSmartAction();
    try {
      const saved = await invoke<BatchTask>("save_batch_task", {
        task: { id: "", name, script: action ? "" : script, server_ids: [...selected], mode, stop_on_error: stopOnError, smart_action: action },
      });
      setTasks((p) => [...p, saved]);
      success(t("batch.taskSaved", { name }));
    } catch (e) {
      error(String(e));
    }
  }

  function loadTask(id: string) {
    setSelectedTaskId(id);
    const task = tasks.find((x) => x.id === id);
    if (!task) return;
    setSelected(new Set(task.server_ids));
    setMode(task.mode);
    setStopOnError(task.stop_on_error);
    if (task.smart_action) {
      setWhat("action");
      setSmartActionType(task.smart_action.type);
      setSmartName(task.smart_action.type === "InstallPackage" || task.smart_action.type === "RestartService" ? task.smart_action.name : "");
    } else {
      setWhat("script");
      setScript(task.script);
    }
  }

  function deleteTask(id: string) {
    invoke("delete_batch_task", { id }).then(() => {
      setTasks((p) => p.filter((x) => x.id !== id));
      setSelectedTaskId((cur) => (cur === id ? "" : cur));
    });
  }

  async function loadPlaybooks() {
    try {
      await invoke("save_ansible_config", { config: ansible });
      setAnsibleConfigured(true);
      setPlaybooks(await invoke<string[]>("ansible_list_playbooks"));
    } catch (e) {
      error(String(e));
    }
  }

  const anyFailed = Object.values(runs).some((r) => r.status === "failed");

  return (
    <div className="p-6 space-y-5">
      <ToastContainer toasts={toasts} onClose={removeToast} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">{t("batch.title")}</h1>
          <p className="text-text-secondary text-xs mt-0.5">{t("batch.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={selectedTaskId} onChange={(e) => loadTask(e.target.value)} aria-label={t("batch.savedTasks.label")} className={cn(inputClass, "w-56")}>
            <option value="">{t("batch.savedTasks.placeholder")}</option>
            {tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
          </select>
          {selectedTaskId && (
            <button onClick={() => deleteTask(selectedTaskId)} title={t("batch.savedTasks.delete")} className="p-2 rounded-win border border-border-primary text-text-secondary hover:text-accent-error hover:bg-bg-hover">
              <Trash2 size={14} />
            </button>
          )}
          {what !== "ansible" && (
            <button onClick={saveTask} disabled={!hasWhat} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-win border border-border-primary hover:bg-bg-hover disabled:opacity-40">
              <Save size={13} /> {t("batch.savedTasks.save")}
            </button>
          )}
        </div>
      </div>

      {/* Étape 1 : cibles */}
      <section className="border border-border-primary rounded-win-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-text-primary">{t("batch.targets.title")}</h2>
          <span className="text-xs text-text-muted">{t("batch.targets.count", { count: selected.size })}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[10rem]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("batch.targets.searchPlaceholder")} aria-label={t("batch.targets.searchPlaceholder")} className={cn(inputClass, "pl-8")} />
          </div>
          <button onClick={selectAll} className="text-xs text-accent-primary hover:underline">{t("batch.targets.selectAll")}</button>
          <button onClick={selectNone} className="text-xs text-accent-primary hover:underline">{t("batch.targets.selectNone")}</button>
          {groups.map((g) => (
            <button key={g.id} onClick={() => addGroup(g.server_ids)} className="px-2 py-1 text-xs rounded-win border border-border-primary text-text-secondary hover:bg-bg-hover">
              {t("batch.targets.group", { name: g.name })}
            </button>
          ))}
        </div>
        {servers.length === 0 ? (
          <p className="text-xs text-text-muted">{t("batch.targets.noServers")}</p>
        ) : filteredServers.length === 0 ? (
          <p className="text-xs text-text-muted">{t("batch.targets.empty")}</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
            {filteredServers.map((s) => {
              const online = statuses[s.id]?.online;
              const os = osByServer[s.id];
              const isLoading = osLoading.has(s.id);
              const isSel = selected.has(s.id);
              return (
                <label key={s.id} className={cn("flex flex-col gap-1 px-2.5 py-2 rounded-win border cursor-pointer", isSel ? "border-accent-primary bg-accent-primary/10" : "border-border-primary hover:bg-bg-hover")}>
                  <span className="flex items-center gap-2 text-sm text-text-primary">
                    <input type="checkbox" checked={isSel} onChange={() => toggle(s.id)} className="accent-accent-primary" />
                    {s.name}
                    {online === false && (
                      <span title={t("batch.targets.offline")}>
                        <WifiOff size={12} className="text-accent-error shrink-0" />
                      </span>
                    )}
                  </span>
                  {isSel && (
                    <span className="flex items-center gap-1.5 text-[11px] ml-6 text-text-muted">
                      {isLoading ? (
                        <><Loader2 size={11} className="animate-spin" /> {t("batch.targets.osDetecting")}</>
                      ) : os?.label ? (
                        <span>{os.label}</span>
                      ) : os?.error ? (
                        <span className="text-yellow-400">{t("batch.targets.osUnknown", { error: os.error })}</span>
                      ) : null}
                      <button type="button" onClick={(e) => { e.preventDefault(); detectOs([s.id], true); }} title={t("batch.targets.redetect")} className="text-text-muted hover:text-accent-primary">
                        <RotateCcw size={11} />
                      </button>
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
        {servers.length > 0 && selected.size === 0 && <p className="text-xs text-text-muted">{t("batch.targets.none")}</p>}
      </section>

      {/* Étape 2 : quoi exécuter */}
      <section className="border border-border-primary rounded-win-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-text-primary">{t("batch.what.title")}</h2>
        <div className="grid sm:grid-cols-3 gap-2">
          {(["action", "script", "ansible"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setWhat(m)}
              className={cn("text-left px-3 py-2.5 rounded-win border space-y-1", what === m ? "border-accent-primary bg-accent-primary/10" : "border-border-primary hover:bg-bg-hover")}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                {m === "action" && <Sparkles size={14} />}
                {m === "script" && <Terminal size={14} />}
                {m === "ansible" && <BookOpen size={14} />}
                {m === "action" ? t("batch.what.action.title") : m === "script" ? t("batch.what.script.title") : t("batch.what.ansible.title")}
              </span>
              <span className="block text-[11px] text-text-muted">
                {m === "action" ? t("batch.what.action.description") : m === "script" ? t("batch.what.script.description") : t("batch.what.ansible.description")}
              </span>
            </button>
          ))}
        </div>

        {what === "action" && (
          <div className="space-y-2 border border-border-primary rounded-win p-3">
            <label className="block">
              <span className="block text-xs text-text-secondary mb-1">{t("batch.what.actionLabel")}</span>
              <select value={smartActionType} onChange={(e) => setSmartActionType(e.target.value as SmartAction["type"])} className={inputClass} aria-label={t("batch.what.actionLabel")}>
                {SMART_ACTION_TYPES.map((a) => (
                  <option key={a} value={a}>{t(`batch.what.actions.${a}`)}</option>
                ))}
              </select>
            </label>
            {(smartActionType === "InstallPackage" || smartActionType === "RestartService") && (
              <label className="block">
                <span className="block text-xs text-text-secondary mb-1">{smartActionType === "InstallPackage" ? t("batch.what.packageNameLabel") : t("batch.what.serviceNameLabel")}</span>
                <input
                  value={smartName}
                  onChange={(e) => setSmartName(e.target.value)}
                  placeholder={smartActionType === "InstallPackage" ? t("batch.what.packageNamePlaceholder") : t("batch.what.serviceNamePlaceholder")}
                  className={inputClass}
                />
              </label>
            )}
          </div>
        )}

        {what === "script" && (
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              {TEMPLATES.map((tpl) => (
                <button key={tpl.nameKey} onClick={() => setScript(tpl.script)} className={cn("px-2.5 py-1 text-xs rounded-win border", looksModifying(tpl.script) ? "border-red-500/30 text-red-400" : "border-border-primary text-text-secondary hover:text-text-primary")}>
                  {t(tpl.nameKey)}
                </button>
              ))}
            </div>
            <textarea ref={scriptRef} value={script} onChange={(e) => setScript(e.target.value)} rows={7} placeholder={"df -h\nuptime"} aria-label={t("batch.what.scriptLabel")} className={cn(inputClass, "font-mono text-xs")} />
            {modifying && (
              <p className="flex items-center gap-2 text-xs text-red-400"><AlertTriangle size={13} /> {t("batch.what.modifyingWarning")}</p>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer text-text-secondary hover:text-text-primary inline-flex items-center gap-1"><Info size={12} /> {t("batch.what.variablesToggle")}</summary>
              <div className="mt-2 space-y-1.5 pl-1">
                <p className="text-[11px] text-text-muted">{t("batch.what.variablesIntro")}</p>
                {TEMPLATE_VARS.map((v) => (
                  <button key={v.labelKey} type="button" onClick={() => insertVariable(v.snippet)} className="block text-left font-mono text-[11px] text-text-secondary hover:text-accent-primary">
                    {t(v.labelKey)}
                  </button>
                ))}
              </div>
            </details>
          </div>
        )}

        {what === "ansible" && (
          <div className="space-y-2">
            {!ansibleConfigured && (
              <p className="flex items-center gap-1.5 text-xs text-yellow-400"><AlertTriangle size={12} /> {t("batch.what.ansible.notConfigured")}</p>
            )}
            <details className="text-xs" open={!ansibleConfigured}>
              <summary className="cursor-pointer text-text-secondary hover:text-text-primary inline-flex items-center gap-1"><Wrench size={12} /> {t("batch.what.ansible.configure")}</summary>
              <div className="mt-2 grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs text-text-secondary mb-1">{t("batch.ansible.host")}</span>
                  <select value={ansible.server_id} onChange={(e) => setAnsible({ ...ansible, server_id: e.target.value })} className={inputClass} aria-label={t("batch.ansible.host")}>
                    <option value="">{t("batch.ansible.chooseHost")}</option>
                    {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs text-text-secondary mb-1">{t("batch.ansible.dir")}</span>
                  <input value={ansible.dir} onChange={(e) => setAnsible({ ...ansible, dir: e.target.value })} className={inputClass} aria-label={t("batch.ansible.dir")} />
                </label>
              </div>
              <button onClick={loadPlaybooks} disabled={!ansible.server_id} className="mt-2 flex items-center gap-1.5 px-3 py-2 text-sm rounded-win border border-border-primary hover:bg-bg-hover disabled:opacity-40">
                <RefreshCw size={13} /> {t("batch.ansible.list")}
              </button>
            </details>
            {playbooks && (
              playbooks.length === 0 ? <p className="text-xs text-text-muted">{t("batch.ansible.none", { dir: ansible.dir })}</p> : (
                <>
                  <select value={playbook} onChange={(e) => setPlaybook(e.target.value)} className={inputClass} aria-label={t("batch.ansible.playbook")}>
                    <option value="">{t("batch.ansible.choosePlaybook")}</option>
                    {playbooks.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <div className="flex items-center gap-4 text-sm text-text-secondary flex-wrap">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={check} onChange={(e) => setCheck(e.target.checked)} className="accent-accent-primary" /> {t("batch.ansible.check")}</label>
                    <input value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={t("batch.ansible.limitPlaceholder")} aria-label={t("batch.ansible.limitLabel")} className="bg-bg-input border border-border-primary rounded-win px-3 py-1.5 text-sm text-text-primary" />
                  </div>
                </>
              )
            )}
          </div>
        )}
      </section>

      {/* Étape 3 : options & lancement */}
      <section className="border border-border-primary rounded-win-lg p-4 space-y-3">
        <h2 className="text-sm font-semibold text-text-primary">{t("batch.options.title")}</h2>
        {what !== "ansible" && (
          <div className="flex items-center gap-4 text-sm text-text-secondary flex-wrap">
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "Parallel"} onChange={() => setMode("Parallel")} className="accent-accent-primary" /> {t("batch.options.parallel")}</label>
            <label className="flex items-center gap-2"><input type="radio" checked={mode === "Sequential"} onChange={() => setMode("Sequential")} className="accent-accent-primary" /> {t("batch.options.sequential")}</label>
            <label className={cn("flex items-center gap-2", mode !== "Sequential" && "opacity-40")}>
              <input type="checkbox" disabled={mode !== "Sequential"} checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} className="accent-accent-primary" /> {t("batch.options.stopOnError")}
            </label>
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={openPreview}
            disabled={launchDisabled}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm rounded-win text-white disabled:opacity-40",
              (modifying || (what === "ansible" && !check)) ? "bg-red-600 hover:bg-red-500" : "bg-accent-primary hover:bg-accent-secondary"
            )}
          >
            {previewLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {what === "ansible" ? (check ? t("batch.ansible.simulate") : t("batch.ansible.runForReal")) : t("batch.options.launch")}
          </button>
          {launchDisabled && <span className="text-xs text-text-muted">{t("batch.options.hint")}</span>}
        </div>
      </section>

      {/* Résultats */}
      {Object.keys(runs).length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-text-primary">{t("batch.results.title")}</h2>
            {anyFailed && (
              <button onClick={relaunchFailed} className="flex items-center gap-1.5 text-xs text-accent-primary hover:underline">
                <RotateCcw size={12} /> {t("batch.results.retryFailed")}
              </button>
            )}
          </div>
          <RunOutput runs={runs} names={names} onSend={sendInput} />
        </section>
      )}

      {confirmingPreview && preview && (
        <ConfirmDialog
          title={t("batch.preview.title")}
          message={t("batch.preview.intro")}
          confirmLabel={t("batch.preview.launch")}
          confirmDisabled={!preview.some((p) => p.command)}
          dangerous={modifying}
          onCancel={() => setConfirmingPreview(false)}
          onConfirm={launch}
        >
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {preview.length === 0 && <p className="text-xs text-text-muted">{t("batch.preview.empty")}</p>}
            {!preview.some((p) => p.command) && preview.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-yellow-400"><AlertTriangle size={12} /> {t("batch.preview.noneResolved")}</p>
            )}
            {preview.map((p) => (
              <div key={p.server_id} className="text-xs border border-border-primary rounded-win p-2">
                <p className="text-text-primary font-medium">{p.name}{p.os_label && <span className="text-text-muted font-normal"> — {p.os_label}</span>}</p>
                {p.command ? (
                  <pre className="mt-1 font-mono text-[11px] text-text-secondary whitespace-pre-wrap break-all">{p.command}</pre>
                ) : (
                  <p className="mt-1 text-yellow-400">{t("batch.preview.skipped", { reason: p.skip_reason ?? "" })}</p>
                )}
              </div>
            ))}
          </div>
        </ConfirmDialog>
      )}

      {confirmAnsible && (
        <ConfirmDialog
          title={check ? t("batch.confirm.ansibleSimulateTitle") : t("batch.confirm.ansiblePlaybookTitle")}
          message={`${playbook}${limit ? ` (${t("batch.confirm.limit", { limit })})` : ""}\n${check ? t("batch.confirm.checkNote") : t("batch.confirm.applyNote")}`}
          confirmLabel={check ? t("batch.ansible.simulate") : t("batch.ansible.runForReal")}
          dangerous={!check}
          onCancel={() => setConfirmAnsible(false)}
          onConfirm={confirmRunPlaybook}
        />
      )}
    </div>
  );
}

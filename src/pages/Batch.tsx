import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, CheckCircle2, Loader2, MinusCircle, Play, Save, Trash2, XCircle, ListChecks, BookOpen, RefreshCw, MessageSquareWarning, CornerDownLeft } from "lucide-react";
import { useStore } from "../stores/useStore";
import { AnsibleConfig, BatchMode, BatchTask, BatchUpdate } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { detectPrompt, looksModifying, TEMPLATES } from "../utils/batch";
import { usePersistentState } from "../hooks/usePersistentState";
import { cn } from "../utils";
import { useT } from "../i18n";

/** Pré-remplissage depuis une autre page (ex. Mises à jour) : rien n'est lancé sans confirmation */
export interface BatchPrefill {
  script: string;
  serverIds: string[];
}

type ServerRun = { status: "pending" | "running" | "ok" | "failed" | "skipped"; output: string; detail?: string; ms?: number };

const inputClass = "w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary";

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

/** Sortie par serveur d'une exécution (script en lot ou playbook) */
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
  const { servers, groups } = useStore();
  const { toasts, removeToast, success, error } = useToast();
  const prefill = useLocation().state as BatchPrefill | null;
  const [tab, setTab] = useState<"script" | "ansible">("script");
  // Texte de commande et sélection de cibles : conservés en quittant la page (ex.
  // aller vérifier un serveur puis revenir) pour ne pas perdre ce qui a été saisi.
  const [script, setScript] = usePersistentState("batch.script", prefill?.script ?? "");
  const [selected, setSelected] = usePersistentState<Set<string>>("batch.selected", new Set(prefill?.serverIds ?? []));
  // Un préremplissage explicite (venu d'une autre page via la navigation) prime
  // toujours sur un brouillon précédent de cette même page.
  useEffect(() => {
    if (prefill?.script !== undefined) setScript(prefill.script);
    if (prefill?.serverIds) setSelected(new Set(prefill.serverIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [mode, setMode] = useState<BatchMode>("Parallel");
  const [stopOnError, setStopOnError] = useState(false);
  const [tasks, setTasks] = useState<BatchTask[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [runs, setRuns] = useState<Record<string, ServerRun>>({});
  const runId = useRef<string | null>(null);

  // Ansible
  const [ansible, setAnsible] = useState<AnsibleConfig>({ server_id: "", dir: "/etc/ansible" });
  const [playbooks, setPlaybooks] = useState<string[] | null>(null);
  const [playbook, setPlaybook] = useState("");
  const [check, setCheck] = useState(true);
  const [limit, setLimit] = useState("");
  const [confirmAnsible, setConfirmAnsible] = useState(false);

  useEffect(() => {
    invoke<BatchTask[]>("get_batch_tasks").then(setTasks).catch(() => {});
    invoke<AnsibleConfig | null>("get_ansible_config").then((c) => c && setAnsible(c)).catch(() => {});
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
  const modifying = looksModifying(script);
  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function run() {
    setConfirming(false);
    const ids = [...selected];
    setRuns(Object.fromEntries(ids.map((id) => [id, { status: "pending", output: "" } as ServerRun])));
    try {
      runId.current = await invoke<string>("run_batch", { script, serverIds: ids, mode, stopOnError });
    } catch (e) {
      error(String(e));
    }
  }

  async function runPlaybook() {
    setConfirmAnsible(false);
    setRuns({ [ansible.server_id]: { status: "pending", output: "" } });
    try {
      runId.current = await invoke<string>("ansible_run", { playbook, check, limit: limit || null });
    } catch (e) {
      error(String(e));
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
    try {
      const saved = await invoke<BatchTask>("save_batch_task", { task: { id: "", name, script, server_ids: [...selected], mode, stop_on_error: stopOnError } });
      setTasks((p) => [...p, saved]);
      success(t("batch.taskSaved", { name }));
    } catch (e) {
      error(String(e));
    }
  }

  async function loadPlaybooks() {
    try {
      await invoke("save_ansible_config", { config: ansible });
      setPlaybooks(await invoke<string[]>("ansible_list_playbooks"));
    } catch (e) {
      error(String(e));
    }
  }

  return (
    <div className="p-6 space-y-5">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div>
        <h1 className="text-text-primary font-semibold text-lg">{t("batch.title")}</h1>
        <p className="text-text-secondary text-xs mt-0.5">{t("batch.subtitle")}</p>
      </div>
      <div className="flex gap-2">
        {([["script", t("batch.tabScript"), ListChecks], ["ansible", "Ansible", BookOpen]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={cn("flex items-center gap-2 px-4 py-2 rounded-win border text-sm", tab === id ? "border-accent-primary bg-accent-primary/10 text-text-primary" : "border-border-primary text-text-secondary hover:bg-bg-hover")}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === "script" ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_16rem] gap-4">
          <div className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              {TEMPLATES.map((tpl) => (
                <button key={tpl.nameKey} onClick={() => setScript(tpl.script)} className={cn("px-2.5 py-1 text-xs rounded-win border", looksModifying(tpl.script) ? "border-red-500/30 text-red-400" : "border-border-primary text-text-secondary hover:text-text-primary")}>
                  {t(tpl.nameKey)}
                </button>
              ))}
              {tasks.map((task) => (
                <span key={task.id} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-win border border-accent-primary/40 text-accent-primary">
                  <button onClick={() => { setScript(task.script); setSelected(new Set(task.server_ids)); setMode(task.mode); setStopOnError(task.stop_on_error); }}>{task.name}</button>
                  <button onClick={() => invoke("delete_batch_task", { id: task.id }).then(() => setTasks((p) => p.filter((x) => x.id !== task.id)))} title={t("common.delete")}><Trash2 size={11} /></button>
                </span>
              ))}
            </div>
            <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={8} placeholder={"df -h\nuptime"} aria-label={t("batch.scriptLabel")} className={cn(inputClass, "font-mono text-xs")} />
            {modifying && (
              <p className="flex items-center gap-2 text-xs text-red-400"><AlertTriangle size={13} /> {t("batch.modifyingWarning")}</p>
            )}
            <div className="flex items-center gap-4 text-sm text-text-secondary flex-wrap">
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "Parallel"} onChange={() => setMode("Parallel")} className="accent-accent-primary" /> {t("batch.parallel")}</label>
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "Sequential"} onChange={() => setMode("Sequential")} className="accent-accent-primary" /> {t("batch.sequential")}</label>
              <label className={cn("flex items-center gap-2", mode !== "Sequential" && "opacity-40")}>
                <input type="checkbox" disabled={mode !== "Sequential"} checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} className="accent-accent-primary" /> {t("batch.stopOnError")}
              </label>
              <div className="ml-auto flex gap-2">
                <button onClick={saveTask} disabled={!script.trim()} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-win border border-border-primary hover:bg-bg-hover disabled:opacity-40"><Save size={13} /> {t("batch.saveTask")}</button>
                <button onClick={() => setConfirming(true)} disabled={!script.trim() || selected.size === 0} className={cn("flex items-center gap-1.5 px-4 py-2 text-sm rounded-win text-white disabled:opacity-40", modifying ? "bg-red-600 hover:bg-red-500" : "bg-accent-primary hover:bg-accent-secondary")}>
                  <Play size={13} /> {t("batch.runOn", { count: selected.size })}
                </button>
              </div>
            </div>
          </div>
          <div className="bg-bg-tertiary border border-border-primary rounded-win p-3 space-y-2 h-fit">
            <p className="text-xs font-medium text-text-secondary">{t("batch.targets")}</p>
            {groups.map((g) => (
              <button key={g.id} onClick={() => setSelected(new Set(g.server_ids))} className="block text-xs text-accent-primary hover:underline">{t("batch.group", { name: g.name })}</button>
            ))}
            {servers.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} className="accent-accent-primary" /> {s.name}
              </label>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3 max-w-2xl">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="block text-xs text-text-secondary mb-1">{t("batch.ansible.host")}</span>
              <select value={ansible.server_id} onChange={(e) => setAnsible({ ...ansible, server_id: e.target.value })} className={inputClass} aria-label={t("batch.ansible.host")}>
                <option value="">{t("batch.ansible.chooseHost")}</option>
                {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="block text-xs text-text-secondary mb-1">{t("batch.ansible.dir")}</span>
              <input value={ansible.dir} onChange={(e) => setAnsible({ ...ansible, dir: e.target.value })} className={inputClass} aria-label={t("batch.ansible.dir")} />
            </label>
          </div>
          <button onClick={loadPlaybooks} disabled={!ansible.server_id} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-win border border-border-primary hover:bg-bg-hover disabled:opacity-40"><RefreshCw size={13} /> {t("batch.ansible.list")}</button>
          {playbooks && (
            playbooks.length === 0 ? <p className="text-xs text-text-muted">{t("batch.ansible.none", { dir: ansible.dir })}</p> : (
              <>
                <select value={playbook} onChange={(e) => setPlaybook(e.target.value)} className={inputClass} aria-label={t("batch.ansible.playbook")}>
                  <option value="">{t("batch.ansible.choosePlaybook")}</option>
                  {playbooks.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <div className="flex items-center gap-4 text-sm text-text-secondary">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={check} onChange={(e) => setCheck(e.target.checked)} className="accent-accent-primary" /> {t("batch.ansible.check")}</label>
                  <input value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={t("batch.ansible.limitPlaceholder")} aria-label={t("batch.ansible.limitLabel")} className="bg-bg-input border border-border-primary rounded-win px-3 py-1.5 text-sm text-text-primary" />
                  <button onClick={() => setConfirmAnsible(true)} disabled={!playbook} className={cn("ml-auto flex items-center gap-1.5 px-4 py-2 text-sm rounded-win text-white disabled:opacity-40", check ? "bg-accent-primary hover:bg-accent-secondary" : "bg-red-600 hover:bg-red-500")}>
                    <Play size={13} /> {check ? t("batch.ansible.simulate") : t("batch.ansible.runForReal")}
                  </button>
                </div>
              </>
            )
          )}
        </div>
      )}

      {Object.keys(runs).length > 0 && <RunOutput runs={runs} names={names} onSend={sendInput} />}

      {confirming && (
        <ConfirmDialog
          title={modifying ? t("batch.confirm.modifyingTitle") : t("batch.confirm.runTitle")}
          message={`${t("batch.confirm.on", {
            servers: [...selected].map((id) => names[id]).join(", "),
            mode: mode === "Parallel" ? t("batch.confirm.parallel") : t("batch.confirm.sequential"),
          })}\n\n${script}`}
          confirmLabel={t("batch.execute")}
          dangerous={modifying}
          onCancel={() => setConfirming(false)}
          onConfirm={run}
        />
      )}
      {confirmAnsible && (
        <ConfirmDialog
          title={check ? t("batch.confirm.simulateTitle") : t("batch.confirm.playbookTitle")}
          message={`${playbook}${limit ? ` (${t("batch.confirm.limit", { limit })})` : ""}\n${check ? t("batch.confirm.checkNote") : t("batch.confirm.applyNote")}`}
          confirmLabel={check ? t("batch.ansible.simulate") : t("batch.execute")}
          dangerous={!check}
          onCancel={() => setConfirmAnsible(false)}
          onConfirm={runPlaybook}
        />
      )}
    </div>
  );
}

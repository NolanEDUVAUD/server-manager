import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { KeyRound, Loader2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { AgentStatus, AuthMethod, Server, SshKeyView } from "../types";
import { AUTH_METHODS, authWarning, jumpCandidates, jumpDependents } from "../utils/sshAuth";
import { cn } from "../utils";
import { useT } from "../i18n";
import { InfoPopover } from "./InfoPopover";

export interface AuthFieldsValue {
  auth_method: AuthMethod;
  ssh_key_id: string | null;
  jump_host_id: string | null;
  clear_password: boolean;
}

interface ServerAuthFieldsProps {
  /** Absent pour un nouveau serveur */
  serverId?: string;
  servers: Server[];
  /** null = chargement en cours */
  keys: SshKeyView[] | null;
  keysError?: string;
  value: AuthFieldsValue;
  onChange: (patch: Partial<AuthFieldsValue>) => void;
}

const selectClass =
  "w-full bg-bg-secondary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary transition-colors disabled:opacity-50";
const labelClass = "block text-xs font-medium text-text-secondary mb-1";

/** Méthode d'authentification SSH, clé de l'app et hôte de rebond d'un serveur */
export function ServerAuthFields({ serverId, servers, keys, keysError, value, onChange }: ServerAuthFieldsProps) {
  const { t } = useT();
  const method = value.auth_method;
  const warning = keys ? authWarning(method, keys, value.ssh_key_id) : null;
  const candidates = jumpCandidates(servers, serverId);
  const dependents = jumpDependents(servers, serverId);
  const currentJumpMissing = !!value.jump_host_id && !candidates.some((s) => s.id === value.jump_host_id);

  return (
    <div className="space-y-3 rounded-win border border-border-primary p-3">
      <div>
        <span className={cn(labelClass, "flex items-center gap-1.5")}>
          {t("sshAuth.title")}
          <InfoPopover label={t("sshAuth.agentInfoLabel")}>{t("sshAuth.agentInfo")}</InfoPopover>
        </span>
        <div role="radiogroup" aria-label={t("sshAuth.methodAria")} className="flex gap-2 flex-wrap">
          {AUTH_METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={method === m.value}
              title={t(m.hintKey)}
              onClick={() => onChange({ auth_method: m.value, ...(m.value === "Password" ? { clear_password: false } : {}) })}
              className={cn(
                "px-3 py-1.5 rounded-win text-sm border transition-all duration-150",
                method === m.value
                  ? "bg-accent-primary border-accent-primary text-white"
                  : "border-border-primary text-text-secondary hover:border-accent-primary/50 hover:text-text-primary"
              )}
            >
              {t(m.labelKey)}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-muted mt-1">{AUTH_METHODS.filter((m) => m.value === method).map((m) => t(m.hintKey))}</p>
      </div>

      {method === "Key" && (
        <div>
          <label className={labelClass} htmlFor="ssh-key-select">{t("sshAuth.appKey")}</label>
          {keys === null && !keysError && (
            <p className="flex items-center gap-1.5 text-xs text-text-muted"><Loader2 size={12} className="animate-spin" /> {t("sshAuth.loadingKeys")}</p>
          )}
          {keysError && <p className="text-xs text-red-400">{keysError}</p>}
          {keys && keys.length > 0 && (
            <select
              id="ssh-key-select"
              className={selectClass}
              value={value.ssh_key_id ?? ""}
              onChange={(e) => onChange({ ssh_key_id: e.target.value || null })}
            >
              <option value="">{t("sshAuth.chooseKey")}</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>{k.name} ({k.algorithm}, {k.fingerprint.slice(0, 19)}…)</option>
              ))}
              {value.ssh_key_id && !keys.some((k) => k.id === value.ssh_key_id) && (
                <option value={value.ssh_key_id}>{t("sshAuth.keyDeleted")}</option>
              )}
            </select>
          )}
        </div>
      )}

      {warning && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-yellow-400">
          <AlertTriangle size={13} className="shrink-0 mt-px" /> {warning}
        </p>
      )}

      {method === "Agent" && <AgentCheck />}

      {serverId && method !== "Password" && (
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={value.clear_password}
            onChange={(e) => onChange({ clear_password: e.target.checked })}
            className="accent-accent-primary"
          />
          {t("sshAuth.clearPassword")}
        </label>
      )}

      <div>
        <label className={labelClass} htmlFor="jump-host-select">{t("sshAuth.jumpHost")}</label>
        <select
          id="jump-host-select"
          className={selectClass}
          value={value.jump_host_id ?? ""}
          disabled={dependents.length > 0 && !value.jump_host_id}
          onChange={(e) => onChange({ jump_host_id: e.target.value || null })}
        >
          <option value="">{t("sshAuth.jumpNone")}</option>
          {candidates.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.ip})</option>
          ))}
          {currentJumpMissing && <option value={value.jump_host_id ?? ""}>{t("sshAuth.jumpMissing")}</option>}
        </select>
        {dependents.length > 0 ? (
          <p className="text-[11px] text-text-muted mt-1">
            {t("sshAuth.jumpDependents", { servers: dependents.map((s) => s.name).join(", ") })}
          </p>
        ) : (
          <p className="text-[11px] text-text-muted mt-1">
            {t("sshAuth.jumpHelp")}
          </p>
        )}
      </div>
    </div>
  );
}

/** Teste à la demande qu'un agent SSH est joignable, quel type et combien de clés il propose */
function AgentCheck() {
  const { t } = useT();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function check() {
    setLoading(true);
    setError("");
    try {
      setStatus(await invoke<AgentStatus>("ssh_agent_status"));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="text-xs space-y-1.5">
      <button
        type="button"
        onClick={check}
        disabled={loading}
        title={t("sshAuth.checkAgent")}
        className="flex items-center gap-1.5 text-accent-primary hover:underline disabled:opacity-50"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
        {loading ? t("sshAuth.agentTesting") : t("sshAuth.checkAgent")}
      </button>
      {error && (
        <p className="flex items-center gap-1.5 text-red-400"><XCircle size={13} className="shrink-0" /> {error}</p>
      )}
      {status && (
        <div className="space-y-1">
          {status.sources.map((source) => {
            const keys = status.keys.filter((k) => k.source === source);
            return (
              <div key={source} className="flex items-start gap-1.5">
                {keys.length > 0 ? (
                  <CheckCircle2 size={13} className="shrink-0 mt-px text-accent-success" />
                ) : (
                  <AlertTriangle size={13} className="shrink-0 mt-px text-yellow-400" />
                )}
                <div>
                  <p className="text-text-secondary">
                    {keys.length > 0
                      ? t(keys.length === 1 ? "sshAuth.agentSource" : "sshAuth.agentSourcePlural", { source, count: keys.length })
                      : t("sshAuth.agentNoKeysInSource", { source })}
                  </p>
                  {keys.map((k) => (
                    <p key={k.fingerprint} className="font-mono text-[11px] text-text-muted break-all" title={`${k.algorithm} ${k.fingerprint}`}>
                      {k.algorithm} · {k.fingerprint}
                      {k.comment && ` · ${k.comment}`}
                    </p>
                  ))}
                </div>
              </div>
            );
          })}
          {!status.available && (
            <p className="flex items-start gap-1.5 text-yellow-400">
              <XCircle size={13} className="shrink-0 mt-px" /> {t("sshAuth.agentUnreachable")} {status.hint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

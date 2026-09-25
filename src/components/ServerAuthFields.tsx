import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { KeyRound, Loader2, AlertTriangle } from "lucide-react";
import { AgentStatus, AuthMethod, Server, SshKeyView } from "../types";
import { AUTH_METHODS, authWarning, jumpCandidates, jumpDependents } from "../utils/sshAuth";
import { cn } from "../utils";

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
  const method = value.auth_method;
  const warning = keys ? authWarning(method, keys, value.ssh_key_id) : null;
  const candidates = jumpCandidates(servers, serverId);
  const dependents = jumpDependents(servers, serverId);
  const currentJumpMissing = !!value.jump_host_id && !candidates.some((s) => s.id === value.jump_host_id);

  return (
    <div className="space-y-3 rounded-win border border-border-primary p-3">
      <div>
        <span className={labelClass}>Authentification SSH</span>
        <div role="radiogroup" aria-label="Méthode d'authentification SSH" className="flex gap-2 flex-wrap">
          {AUTH_METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={method === m.value}
              onClick={() => onChange({ auth_method: m.value, ...(m.value === "Password" ? { clear_password: false } : {}) })}
              className={cn(
                "px-3 py-1.5 rounded-win text-sm border transition-all duration-150",
                method === m.value
                  ? "bg-accent-primary border-accent-primary text-white"
                  : "border-border-primary text-text-secondary hover:border-accent-primary/50 hover:text-text-primary"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-muted mt-1">{AUTH_METHODS.find((m) => m.value === method)?.hint}</p>
      </div>

      {method === "Key" && (
        <div>
          <label className={labelClass} htmlFor="ssh-key-select">Clé de l'app</label>
          {keys === null && !keysError && (
            <p className="flex items-center gap-1.5 text-xs text-text-muted"><Loader2 size={12} className="animate-spin" /> Chargement des clés…</p>
          )}
          {keysError && <p className="text-xs text-red-400">{keysError}</p>}
          {keys && keys.length > 0 && (
            <select
              id="ssh-key-select"
              className={selectClass}
              value={value.ssh_key_id ?? ""}
              onChange={(e) => onChange({ ssh_key_id: e.target.value || null })}
            >
              <option value="">— Choisir une clé —</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>{k.name} ({k.algorithm}, {k.fingerprint.slice(0, 19)}…)</option>
              ))}
              {value.ssh_key_id && !keys.some((k) => k.id === value.ssh_key_id) && (
                <option value={value.ssh_key_id}>Clé supprimée</option>
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
          Effacer le mot de passe enregistré pour ce serveur
        </label>
      )}

      <div>
        <label className={labelClass} htmlFor="jump-host-select">Hôte de rebond (optionnel)</label>
        <select
          id="jump-host-select"
          className={selectClass}
          value={value.jump_host_id ?? ""}
          disabled={dependents.length > 0 && !value.jump_host_id}
          onChange={(e) => onChange({ jump_host_id: e.target.value || null })}
        >
          <option value="">Aucun (connexion directe)</option>
          {candidates.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.ip})</option>
          ))}
          {currentJumpMissing && <option value={value.jump_host_id ?? ""}>Rebond indisponible — à changer</option>}
        </select>
        {dependents.length > 0 ? (
          <p className="text-[11px] text-text-muted mt-1">
            Ce serveur sert de rebond à {dependents.map((s) => s.name).join(", ")} : il ne peut pas passer lui-même par un rebond (un seul niveau).
          </p>
        ) : (
          <p className="text-[11px] text-text-muted mt-1">
            La connexion passe par ce serveur (tunnel SSH) ; la clé d'hôte de chaque saut est vérifiée.
          </p>
        )}
      </div>
    </div>
  );
}

/** Vérifie à la demande qu'un agent SSH est joignable et contient des clés */
function AgentCheck() {
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
    <div className="text-xs space-y-1">
      <button
        type="button"
        onClick={check}
        disabled={loading}
        className="flex items-center gap-1.5 text-accent-primary hover:underline disabled:opacity-50"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />} Vérifier l'agent SSH
      </button>
      {error && <p className="text-red-400">{error}</p>}
      {status && status.available && (
        <p className="text-text-secondary">
          {status.keys.length} clé{status.keys.length > 1 ? "s" : ""} disponible{status.keys.length > 1 ? "s" : ""} ({status.sources.join(", ")}).
        </p>
      )}
      {status && !status.available && (
        <p className="text-yellow-400">Aucun agent SSH joignable. {status.hint}</p>
      )}
    </div>
  );
}

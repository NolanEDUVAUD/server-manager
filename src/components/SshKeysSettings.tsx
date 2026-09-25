import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, KeyRound, Loader2, Pencil, Plus, Trash2, Upload, Check, X } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { ToastContainer } from "./Toast";
import { useToast } from "../hooks/useToast";
import { useStore } from "../stores/useStore";
import { AgentStatus, KeyFileInfo, SshKeyView } from "../types";
import { keyUsers, suggestedKeyName } from "../utils/sshAuth";

const inputClass =
  "w-full bg-bg-input border border-border-primary rounded-win px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-primary";
const buttonClass =
  "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-50";
const primaryClass =
  "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-win bg-accent-primary text-white hover:bg-accent-secondary disabled:opacity-50";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Paramètres → Clés SSH : la clé privée ne quitte jamais le backend (seule la clé publique est affichée) */
export function SshKeysSettings() {
  const servers = useStore((s) => s.servers);
  const toast = useToast();
  const [keys, setKeys] = useState<SshKeyView[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<SshKeyView | null>(null);

  // Import : fichier lu côté Rust, puis nom et phrase de passe éventuelle
  const [pending, setPending] = useState<KeyFileInfo | null>(null);
  const [importName, setImportName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [importError, setImportError] = useState("");

  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);

  useEffect(() => {
    invoke<SshKeyView[]>("ssh_keys_list").then(setKeys).catch((e) => setLoadError(String(e)));
    // Un fichier choisi puis abandonné (changement d'onglet) est oublié côté Rust
    return () => {
      invoke("ssh_key_import_cancel").catch(() => {});
    };
  }, []);

  async function generate() {
    setBusy(true);
    try {
      const key = await invoke<SshKeyView>("ssh_key_generate", { name: newName });
      setKeys((k) => [...(k ?? []), key]);
      setNewName("");
      toast.success(`Clé « ${key.name} » générée`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pickFile() {
    setImportError("");
    try {
      const info = await invoke<KeyFileInfo | null>("ssh_key_import_pick");
      if (!info) return;
      setPending(info);
      setImportName(suggestedKeyName(info));
      setPassphrase("");
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function confirmImport() {
    setBusy(true);
    setImportError("");
    try {
      const key = await invoke<SshKeyView>("ssh_key_import", { name: importName, passphrase: passphrase || null });
      setKeys((k) => [...(k ?? []), key]);
      setPending(null);
      toast.success(`Clé « ${key.name} » importée : elle est rechiffrée par l'app, la phrase de passe n'est plus nécessaire`);
    } catch (e) {
      // Le fichier reste en attente : on peut corriger la phrase de passe ou le nom
      setImportError(String(e));
    } finally {
      setPassphrase("");
      setBusy(false);
    }
  }

  async function cancelImport() {
    setPending(null);
    setPassphrase("");
    setImportError("");
    await invoke("ssh_key_import_cancel").catch(() => {});
  }

  async function copyPublic(key: SshKeyView) {
    try {
      await navigator.clipboard.writeText(key.public_key);
      toast.success("Clé publique copiée");
    } catch {
      toast.error("Copie impossible : sélectionne la clé publique et copie-la à la main");
    }
  }

  async function rename() {
    if (!renaming) return;
    try {
      const key = await invoke<SshKeyView>("ssh_key_rename", { id: renaming.id, name: renaming.name });
      setKeys((k) => (k ?? []).map((x) => (x.id === key.id ? key : x)));
      setRenaming(null);
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function remove(key: SshKeyView) {
    try {
      await invoke("ssh_key_delete", { id: key.id });
      setKeys((k) => (k ?? []).filter((x) => x.id !== key.id));
      toast.success(`Clé « ${key.name} » supprimée`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeleting(null);
    }
  }

  async function checkAgent() {
    setAgentLoading(true);
    try {
      setAgent(await invoke<AgentStatus>("ssh_agent_status"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setAgentLoading(false);
    }
  }

  const deletingUsers = deleting ? keyUsers(servers, deleting.id) : [];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-text-primary font-medium text-base">Clés SSH</h2>
        <p className="text-text-muted text-xs mt-1">
          Connexion aux serveurs sans mot de passe. La clé privée est chiffrée avec la clé maître et ne quitte jamais l'app ;
          seule la clé publique est affichée. Choisis ensuite « Clé de l'app » dans la fiche d'un serveur, ou utilise « Déployer la clé » sur sa carte.
        </p>
      </div>

      {/* Générer / importer */}
      <div className="bg-bg-tertiary rounded-win p-4 card space-y-3">
        <div className="flex gap-2 items-end">
          <label className="flex-1">
            <span className="block text-xs text-text-secondary mb-1">Nouvelle clé ed25519</span>
            <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nom (ex. Portable)" aria-label="Nom de la nouvelle clé" />
          </label>
          <button onClick={generate} disabled={busy || !newName.trim()} className={primaryClass}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Générer
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={pickFile} disabled={busy || !!pending} className={buttonClass}>
            <Upload size={12} /> Importer une clé existante…
          </button>
          <span className="text-[11px] text-text-muted">OpenSSH (id_ed25519, id_rsa…) ou PuTTY .ppk, chiffrée ou non</span>
        </div>

        {pending && (
          <div className="border border-border-primary rounded-win p-3 space-y-2">
            <p className="text-xs text-text-secondary">
              <span className="text-text-primary font-medium">{pending.file_name}</span> — {pending.format}
              {pending.algorithm && ` · ${pending.algorithm}`}
              {pending.encrypted && " · protégée par une phrase de passe"}
            </p>
            <label className="block">
              <span className="block text-xs text-text-secondary mb-1">Nom dans l'app</span>
              <input className={inputClass} value={importName} onChange={(e) => setImportName(e.target.value)} aria-label="Nom de la clé importée" />
            </label>
            {pending.encrypted && (
              <label className="block">
                <span className="block text-xs text-text-secondary mb-1">Phrase de passe</span>
                <input type="password" className={inputClass} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="off" aria-label="Phrase de passe de la clé" />
              </label>
            )}
            {importError && <p className="text-xs text-red-400">{importError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={cancelImport} className={buttonClass}>Annuler</button>
              <button onClick={confirmImport} disabled={busy || !importName.trim() || (pending.encrypted && !passphrase)} className={primaryClass}>
                {busy && <Loader2 size={12} className="animate-spin" />} Importer
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Liste */}
      <div className="space-y-2">
        {loadError && <p className="text-xs text-red-400">{loadError}</p>}
        {keys === null && !loadError && (
          <p className="flex items-center gap-2 text-xs text-text-muted"><Loader2 size={12} className="animate-spin" /> Chargement des clés…</p>
        )}
        {keys && keys.length === 0 && (
          <div className="text-center py-8 border border-dashed border-border-primary rounded-win">
            <KeyRound size={22} className="mx-auto text-text-muted mb-2" />
            <p className="text-sm text-text-primary">Aucune clé SSH</p>
            <p className="text-xs text-text-muted mt-1">Génère une clé ed25519 ou importe une clé existante ci-dessus.</p>
          </div>
        )}
        {keys?.map((key) => {
          const users = keyUsers(servers, key.id);
          return (
            <div key={key.id} className="bg-bg-tertiary border border-border-primary rounded-win px-4 py-3 space-y-1">
              <div className="flex items-center gap-2">
                <KeyRound size={14} className="text-accent-primary shrink-0" />
                {renaming?.id === key.id ? (
                  <>
                    <input
                      className={inputClass}
                      value={renaming.name}
                      onChange={(e) => setRenaming({ id: key.id, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") setRenaming(null); }}
                      aria-label="Nouveau nom de la clé"
                      autoFocus
                    />
                    <button onClick={rename} className="p-1.5 text-accent-success" title="Enregistrer"><Check size={13} /></button>
                    <button onClick={() => setRenaming(null)} className="p-1.5 text-text-muted" title="Annuler"><X size={13} /></button>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-text-primary font-medium flex-1 truncate">{key.name}</span>
                    <button onClick={() => copyPublic(key)} className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10" title="Copier la clé publique" aria-label={`Copier la clé publique ${key.name}`}>
                      <Copy size={13} />
                    </button>
                    <button onClick={() => setRenaming({ id: key.id, name: key.name })} className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10" title="Renommer">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => setDeleting(key)} className="p-1.5 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10" title="Supprimer" aria-label={`Supprimer la clé ${key.name}`}>
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
              <p className="text-xs text-text-muted font-mono break-all">{key.algorithm} · {key.fingerprint}</p>
              <p className="text-[11px] text-text-muted">
                Créée le {formatDate(key.created_at)} · {users.length === 0 ? "utilisée par aucun serveur" : `utilisée par ${users.map((s) => s.name).join(", ")}`}
              </p>
            </div>
          );
        })}
      </div>

      {/* Agent SSH */}
      <div className="bg-bg-tertiary rounded-win p-4 card space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-primary">Agent SSH</p>
            <p className="text-xs text-text-muted">Agent OpenSSH de Windows (canal nommé) puis Pageant : méthode « Agent SSH » d'un serveur.</p>
          </div>
          <button onClick={checkAgent} disabled={agentLoading} className={buttonClass}>
            {agentLoading && <Loader2 size={12} className="animate-spin" />} Détecter
          </button>
        </div>
        {agent && agent.available && (
          <ul className="text-xs text-text-secondary space-y-0.5">
            {agent.keys.length === 0 && <li>Agent joignable ({agent.sources.join(", ")}) mais aucune clé chargée.</li>}
            {agent.keys.map((k) => (
              <li key={`${k.source}-${k.fingerprint}`} className="font-mono break-all">{k.source} · {k.algorithm} · {k.fingerprint}{k.comment && ` · ${k.comment}`}</li>
            ))}
          </ul>
        )}
        {agent && !agent.available && (
          <p className="text-xs text-yellow-400">Aucun agent SSH joignable ({agent.errors.join(" ; ")}). {agent.hint}</p>
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          title={`Supprimer la clé « ${deleting.name} »`}
          message={
            deletingUsers.length > 0
              ? `Cette clé est utilisée par ${deletingUsers.map((s) => s.name).join(", ")}. Choisis d'abord une autre méthode d'authentification pour ces serveurs.`
              : "La clé privée sera définitivement effacée de l'app. Les serveurs où la clé publique a été déployée la garderont dans authorized_keys (à retirer à la main si besoin)."
          }
          confirmLabel="Supprimer"
          dangerous
          confirmDisabled={deletingUsers.length > 0}
          onConfirm={() => remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}

      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />
    </div>
  );
}

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useStore } from "../stores/useStore";
import { DeployReport, Server, SshKeyView } from "../types";
import { authMethodOf, deployBlockedReason, deployWarning } from "../utils/sshAuth";

interface DeployKeyDialogProps {
  server: Server;
  onClose: () => void;
  onMessage: (msg: string, type?: "success" | "error" | "info") => void;
}

type Step =
  | { kind: "choose" }
  | { kind: "running" }
  | { kind: "switch"; report: DeployReport }
  | { kind: "failed"; report: DeployReport };

const methodLabel = { Password: "le mot de passe enregistré", Key: "la clé de l'app actuelle", Agent: "l'agent SSH" } as const;

/**
 * « Déployer la clé » : ajoute la clé publique choisie à ~/.ssh/authorized_keys du serveur (via sa
 * méthode d'authentification actuelle), vérifie la connexion par clé, puis propose de basculer le
 * serveur sur cette clé et d'effacer son mot de passe enregistré.
 */
export function DeployKeyDialog({ server, onClose, onMessage }: DeployKeyDialogProps) {
  const [keys, setKeys] = useState<SshKeyView[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [keyId, setKeyId] = useState<string>(server.ssh_key_id ?? "");
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [clearPassword, setClearPassword] = useState(true);
  const blocked = deployBlockedReason(server.os_type);

  useEffect(() => {
    invoke<SshKeyView[]>("ssh_keys_list")
      .then((list) => {
        setKeys(list);
        setKeyId((current) => (list.some((k) => k.id === current) ? current : list[0]?.id ?? ""));
      })
      .catch((e) => setLoadError(String(e)));
  }, []);

  const key = keys?.find((k) => k.id === keyId);

  async function deploy() {
    if (!key) return;
    setStep({ kind: "running" });
    try {
      const report = await invoke<DeployReport>("ssh_key_deploy", { serverId: server.id, keyId: key.id });
      setStep(report.verified ? { kind: "switch", report } : { kind: "failed", report });
    } catch (e) {
      onMessage(String(e), "error");
      onClose();
    }
  }

  async function useKey() {
    if (!key) return;
    try {
      const updated = await invoke<Server>("ssh_key_use_for_server", { serverId: server.id, keyId: key.id, clearPassword });
      useStore.setState((s) => ({ servers: s.servers.map((x) => (x.id === updated.id ? updated : x)) }));
      onMessage(`${server.name} utilise maintenant la clé « ${key.name} »`, "success");
    } catch (e) {
      onMessage(String(e), "error");
    }
    onClose();
  }

  if (blocked) {
    return <ConfirmDialog title={`Déployer une clé sur ${server.name}`} message={blocked} confirmLabel="Fermer" onConfirm={onClose} onCancel={onClose} />;
  }

  if (step.kind === "running") {
    return (
      <ConfirmDialog title={`Déploiement sur ${server.name}`} message="Ajout de la clé puis vérification de la connexion par clé…" confirmDisabled confirmLabel="Patiente…" onConfirm={() => {}} onCancel={() => {}}>
        <Loader2 size={16} className="animate-spin text-accent-primary" />
      </ConfirmDialog>
    );
  }

  if (step.kind === "switch" && key) {
    const already = authMethodOf(server) === "Key" && server.ssh_key_id === key.id;
    const added = step.report.added ? "La clé a été ajoutée" : "La clé était déjà présente";
    if (already) {
      return <ConfirmDialog title="Clé déployée" message={`${added} et la connexion par clé fonctionne.`} confirmLabel="Fermer" onConfirm={() => { onMessage("Connexion par clé vérifiée", "success"); onClose(); }} onCancel={onClose} />;
    }
    return (
      <ConfirmDialog
        title={`Utiliser la clé pour ${server.name} ?`}
        message={`${added} dans ~/.ssh/authorized_keys de ${server.ssh_user}@${server.ip} et la connexion par clé fonctionne.\n\nBasculer ${server.name} sur la clé « ${key.name} » pour toutes les connexions de l'app ?`}
        confirmLabel="Utiliser la clé"
        cancelLabel="Garder la méthode actuelle"
        onConfirm={useKey}
        onCancel={() => { onMessage(`Clé déployée sur ${server.name}`, "success"); onClose(); }}
      >
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} className="accent-accent-primary" />
          Effacer le mot de passe enregistré pour ce serveur
        </label>
      </ConfirmDialog>
    );
  }

  if (step.kind === "failed") {
    return (
      <ConfirmDialog
        title="Connexion par clé refusée"
        message={`${step.report.added ? "La clé a été ajoutée" : "La clé était déjà présente"}, mais la connexion par clé a échoué : ${step.report.detail ?? "raison inconnue"}.\n\nVérifie les droits de ~/.ssh (700) et d'authorized_keys (600), et que PubkeyAuthentication est actif dans sshd. Le serveur garde sa méthode actuelle.`}
        confirmLabel="Fermer"
        onConfirm={onClose}
        onCancel={onClose}
      />
    );
  }

  const warning = deployWarning(server.os_type);
  const message = keys === null
    ? loadError || "Chargement des clés…"
    : keys.length === 0
      ? "Aucune clé SSH enregistrée : génère ou importe une clé dans Paramètres → Clés SSH."
      : `La clé publique choisie sera ajoutée à ~/.ssh/authorized_keys de ${server.ssh_user}@${server.ip}, en se connectant avec ${methodLabel[authMethodOf(server)]}${server.jump_host_id ? " (via l'hôte de rebond)" : ""}.\n~/.ssh (700) et authorized_keys (600) sont créés s'ils n'existent pas ; la ligne n'est jamais ajoutée deux fois. La connexion par clé est ensuite vérifiée.${warning ? `\n\n${warning}` : ""}`;

  return (
    <ConfirmDialog
      title={`Déployer une clé sur ${server.name}`}
      message={message}
      confirmLabel="Déployer la clé"
      confirmDisabled={!key}
      onConfirm={deploy}
      onCancel={onClose}
    >
      {keys && keys.length > 0 && (
        <label className="block text-xs text-text-secondary">
          Clé à déployer
          <select
            className="mt-1 w-full bg-bg-secondary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary"
            value={keyId}
            onChange={(e) => setKeyId(e.target.value)}
          >
            {keys.map((k) => (
              <option key={k.id} value={k.id}>{k.name} — {k.fingerprint}</option>
            ))}
          </select>
        </label>
      )}
    </ConfirmDialog>
  );
}

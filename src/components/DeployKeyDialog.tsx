import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { useStore } from "../stores/useStore";
import { DeployReport, Server, SshKeyView } from "../types";
import { authMethodOf, deployBlockedReason, deployWarning } from "../utils/sshAuth";
import { useT } from "../i18n";

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

const methodLabelKey = { Password: "sshAuth.deploy.via.password", Key: "sshAuth.deploy.via.key", Agent: "sshAuth.deploy.via.agent" } as const;

/**
 * « Déployer la clé » : ajoute la clé publique choisie à ~/.ssh/authorized_keys du serveur (via sa
 * méthode d'authentification actuelle), vérifie la connexion par clé, puis propose de basculer le
 * serveur sur cette clé et d'effacer son mot de passe enregistré.
 */
export function DeployKeyDialog({ server, onClose, onMessage }: DeployKeyDialogProps) {
  const { t } = useT();
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
      onMessage(t("sshAuth.deploy.switched", { name: server.name, key: key.name }), "success");
    } catch (e) {
      onMessage(String(e), "error");
    }
    onClose();
  }

  if (blocked) {
    return <ConfirmDialog title={t("sshAuth.deploy.title", { name: server.name })} message={blocked} confirmLabel={t("sshAuth.deploy.close")} onConfirm={onClose} onCancel={onClose} />;
  }

  if (step.kind === "running") {
    return (
      <ConfirmDialog title={t("sshAuth.deploy.runningTitle", { name: server.name })} message={t("sshAuth.deploy.running")} confirmDisabled confirmLabel={t("sshAuth.deploy.wait")} onConfirm={() => {}} onCancel={() => {}}>
        <Loader2 size={16} className="animate-spin text-accent-primary" />
      </ConfirmDialog>
    );
  }

  if (step.kind === "switch" && key) {
    const already = authMethodOf(server) === "Key" && server.ssh_key_id === key.id;
    const added = step.report.added ? t("sshAuth.deploy.added") : t("sshAuth.deploy.alreadyPresent");
    if (already) {
      return <ConfirmDialog title={t("sshAuth.deploy.doneTitle")} message={t("sshAuth.deploy.doneMessage", { added })} confirmLabel={t("sshAuth.deploy.close")} onConfirm={() => { onMessage(t("sshAuth.deploy.verified"), "success"); onClose(); }} onCancel={onClose} />;
    }
    return (
      <ConfirmDialog
        title={t("sshAuth.deploy.switchTitle", { name: server.name })}
        message={t("sshAuth.deploy.switchMessage", { added, target: `${server.ssh_user}@${server.ip}`, name: server.name, key: key.name })}
        confirmLabel={t("sshAuth.deploy.useKey")}
        cancelLabel={t("sshAuth.deploy.keepMethod")}
        onConfirm={useKey}
        onCancel={() => { onMessage(t("sshAuth.deploy.deployedOn", { name: server.name }), "success"); onClose(); }}
      >
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} className="accent-accent-primary" />
          {t("sshAuth.clearPassword")}
        </label>
      </ConfirmDialog>
    );
  }

  if (step.kind === "failed") {
    return (
      <ConfirmDialog
        title={t("sshAuth.deploy.failedTitle")}
        message={t("sshAuth.deploy.failedMessage", { added: step.report.added ? t("sshAuth.deploy.added") : t("sshAuth.deploy.alreadyPresent"), detail: step.report.detail ?? t("sshAuth.deploy.unknownReason") })}
        confirmLabel={t("sshAuth.deploy.close")}
        onConfirm={onClose}
        onCancel={onClose}
      />
    );
  }

  const warning = deployWarning(server.os_type);
  const message = keys === null
    ? loadError || t("sshAuth.loadingKeys")
    : keys.length === 0
      ? t("sshAuth.deploy.noKeys")
      : t("sshAuth.deploy.explain", {
          target: `${server.ssh_user}@${server.ip}`,
          via: t(methodLabelKey[authMethodOf(server)]),
          jump: server.jump_host_id ? t("sshAuth.deploy.viaJump") : "",
        }) + (warning ? `\n\n${warning}` : "");

  return (
    <ConfirmDialog
      title={t("sshAuth.deploy.title", { name: server.name })}
      message={message}
      confirmLabel={t("sshAuth.deploy.confirm")}
      confirmDisabled={!key}
      onConfirm={deploy}
      onCancel={onClose}
    >
      {keys && keys.length > 0 && (
        <label className="block text-xs text-text-secondary">
          {t("sshAuth.deploy.keyToDeploy")}
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

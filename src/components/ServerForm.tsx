import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Server, Eye, EyeOff } from "lucide-react";
import {
  Server as ServerType,
  ServerPayload,
  OsType,
  OS_TYPES,
  OS_ICONS,
  DEFAULT_SSH_PORT,
} from "../types";
import { isValidIP, isValidMAC, formatMAC } from "../utils";
import { IconPicker } from "./IconPicker";
import { ServerOrganisationFields } from "./OrganisationFields";
import { checkCustomFields, isBlankField } from "../utils/organisation";

interface ServerFormProps {
  initial?: ServerType;
  /** Valeurs pré-remplies pour un nouveau serveur (ex. appareil découvert sur le réseau) */
  prefill?: { name?: string; ip?: string; mac_address?: string };
  onSubmit: (payload: ServerPayload) => Promise<void>;
  onCancel: () => void;
}

const OS_SHUTDOWN_DEFAULTS: Record<OsType, string> = {
  Linux: "sudo shutdown -h now",
  Windows: "shutdown /s /t 0",
  Proxmox: "shutdown -h now",
  TrueNAS: "shutdown -p now",
  ESXi: "poweroff",
};

const OS_REBOOT_DEFAULTS: Record<OsType, string> = {
  Linux: "sudo reboot",
  Windows: "shutdown /r /t 0",
  Proxmox: "reboot",
  TrueNAS: "reboot",
  ESXi: "reboot",
};

export function ServerForm({ initial, prefill, onSubmit, onCancel }: ServerFormProps) {
  const [form, setForm] = useState<ServerPayload>({
    name: initial?.name ?? prefill?.name ?? "",
    ip: initial?.ip ?? prefill?.ip ?? "",
    mac_address: initial?.mac_address ?? prefill?.mac_address ?? "",
    ssh_user: initial?.ssh_user ?? "root",
    ssh_password: "",
    ssh_port: initial?.ssh_port ?? DEFAULT_SSH_PORT,
    shutdown_command: initial?.shutdown_command ?? "",
    reboot_command: initial?.reboot_command ?? "",
    os_type: initial?.os_type ?? "Linux",
    icon: initial?.icon ?? "",
    notes: initial?.notes ?? "",
    // Organisation
    tag_ids: initial?.tag_ids ?? [],
    folder_id: initial?.folder_id ?? "",
    custom_fields: initial?.custom_fields ?? [],
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const set = (field: keyof ServerPayload, value: unknown) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-remplir les commandes si changement d'OS et champs vides
      if (field === "os_type") {
        const os = value as OsType;
        if (!prev.shutdown_command || prev.shutdown_command === OS_SHUTDOWN_DEFAULTS[prev.os_type]) {
          next.shutdown_command = OS_SHUTDOWN_DEFAULTS[os];
        }
        if (!prev.reboot_command || prev.reboot_command === OS_REBOOT_DEFAULTS[prev.os_type]) {
          next.reboot_command = OS_REBOOT_DEFAULTS[os];
        }
      }
      return next;
    });
    setErrors((e) => ({ ...e, [field]: "" }));
  };

  const [detecting, setDetecting] = useState(false);
  const [macHint, setMacHint] = useState("");

  /** Lit la MAC de l'IP saisie (ping + table ARP) : lecture seule */
  async function detectMac() {
    setDetecting(true);
    setMacHint("");
    try {
      const r = await invoke<{ mac: string | null; virtual_nic: string | null }>("detect_mac", { ip: form.ip });
      if (!r.mac) setMacHint("Aucune réponse : l'appareil est éteint ou sur un autre réseau.");
      else if (r.virtual_nic) setMacHint(`Carte virtuelle (${r.virtual_nic}) : le Wake-on-LAN est inutile, c'est Proxmox qui la démarre.`);
      else { set("mac_address", r.mac); setMacHint("MAC détectée."); }
    } catch (e) {
      setMacHint(String(e));
    } finally {
      setDetecting(false);
    }
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Le nom est requis";
    if (!isValidIP(form.ip)) errs.ip = "Adresse IP invalide (ex: 192.168.1.10)";
    if (form.mac_address && !isValidMAC(form.mac_address)) {
      errs.mac_address = "Format MAC invalide (ex: AA:BB:CC:DD:EE:FF)";
    }
    if (!form.ssh_user.trim()) errs.ssh_user = "Utilisateur SSH requis";
    if (!initial && !form.ssh_password) errs.ssh_password = "Mot de passe requis pour un nouveau serveur";
    if (form.ssh_port < 1 || form.ssh_port > 65535) errs.ssh_port = "Port invalide (1–65535)";
    const fields = checkCustomFields(form.custom_fields ?? []);
    if (fields.global || fields.rows.some(Boolean)) errs.custom_fields = "Corrige les champs personnalisés";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const payload = { ...form };
      if (form.mac_address) payload.mac_address = formatMAC(form.mac_address);
      payload.custom_fields = (form.custom_fields ?? []).filter((f) => !isBlankField(f));
      await onSubmit(payload);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full bg-bg-secondary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary placeholder-text-secondary/50 focus:outline-none focus:border-accent-primary transition-colors";
  const labelClass = "block text-xs font-medium text-text-secondary mb-1";
  const errorClass = "text-xs text-red-400 mt-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-2xl mx-4 animate-slide-in max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-primary">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-win bg-accent-primary/10">
              <Server size={18} className="text-accent-primary" />
            </div>
            <h2 className="text-text-primary font-semibold">
              {initial ? "Modifier le serveur" : "Ajouter un serveur"}
            </h2>
          </div>
          <button onClick={onCancel} className="text-text-secondary hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Nom */}
          <div>
            <label className={labelClass}>Nom *</label>
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Proxmox Master1"
            />
            {errors.name && <p className={errorClass}>{errors.name}</p>}
          </div>

          {/* Icône */}
          <div className="form-row">
            <label className="text-text-secondary text-xs block mb-1">Icône</label>
            <IconPicker
              serverId={form.name || 'new'}
              value={form.icon || null}
              onChange={icon => set("icon", icon || undefined)}
            />
          </div>

          {/* IP + MAC */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Adresse IP *</label>
              <input
                className={inputClass}
                value={form.ip}
                onChange={(e) => set("ip", e.target.value)}
                placeholder="192.168.1.10"
              />
              {errors.ip && <p className={errorClass}>{errors.ip}</p>}
            </div>
            <div>
              <label className={labelClass}>Adresse MAC (WoL)</label>
              <div className="flex gap-1.5">
                <input
                  className={inputClass}
                  value={form.mac_address}
                  onChange={(e) => set("mac_address", e.target.value)}
                  placeholder="AA:BB:CC:DD:EE:FF"
                />
                <button
                  type="button"
                  onClick={detectMac}
                  disabled={!isValidIP(form.ip) || detecting}
                  className="shrink-0 px-2.5 text-xs rounded-win border border-border-primary text-text-secondary hover:text-accent-primary hover:border-accent-primary/40 disabled:opacity-40"
                  title="Lire la MAC dans la table ARP (même réseau local)"
                >
                  {detecting ? "…" : "Détecter"}
                </button>
              </div>
              {errors.mac_address && <p className={errorClass}>{errors.mac_address}</p>}
              {macHint && <p className="text-[11px] text-text-muted mt-1">{macHint}</p>}
            </div>
          </div>

          {/* OS Type */}
          <div>
            <label className={labelClass}>Type d'OS</label>
            <div className="flex gap-2 flex-wrap">
              {OS_TYPES.map((os) => (
                <button
                  key={os}
                  type="button"
                  onClick={() => set("os_type", os)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-win text-sm border transition-all duration-150
                    ${form.os_type === os
                      ? "bg-accent-primary border-accent-primary text-white"
                      : "border-border-primary text-text-secondary hover:border-accent-primary/50 hover:text-text-primary"
                    }`}
                >
                  <span>{OS_ICONS[os]}</span>
                  {os}
                </button>
              ))}
            </div>
          </div>

          {/* SSH */}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-3">
            <div>
              <label className={labelClass}>Utilisateur SSH *</label>
              <input
                className={inputClass}
                value={form.ssh_user}
                onChange={(e) => set("ssh_user", e.target.value)}
                placeholder="root"
              />
              {errors.ssh_user && <p className={errorClass}>{errors.ssh_user}</p>}
            </div>
            <div className="relative">
              <label className={labelClass}>
                Mot de passe SSH{initial ? " (laisser vide = inchangé)" : " *"}
              </label>
              <input
                className={`${inputClass} pr-9`}
                type={showPassword ? "text" : "password"}
                value={form.ssh_password}
                onChange={(e) => set("ssh_password", e.target.value)}
                placeholder={initial ? "••••••••" : "mot de passe"}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-7 text-text-secondary hover:text-text-primary transition-colors"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              {errors.ssh_password && <p className={errorClass}>{errors.ssh_password}</p>}
            </div>
            <div>
              <label className={labelClass}>Port SSH</label>
              <input
                className={`${inputClass} w-20`}
                type="number"
                value={form.ssh_port}
                onChange={(e) => set("ssh_port", parseInt(e.target.value) || 22)}
                min={1}
                max={65535}
              />
              {errors.ssh_port && <p className={errorClass}>{errors.ssh_port}</p>}
            </div>
          </div>

          {initial && <HostKeyReset serverId={initial.id} />}

          {/* Commandes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Commande d'arrêt</label>
              <input
                className={inputClass}
                value={form.shutdown_command ?? ""}
                onChange={(e) => set("shutdown_command", e.target.value)}
                placeholder={OS_SHUTDOWN_DEFAULTS[form.os_type]}
              />
            </div>
            <div>
              <label className={labelClass}>Commande de redémarrage</label>
              <input
                className={inputClass}
                value={form.reboot_command ?? ""}
                onChange={(e) => set("reboot_command", e.target.value)}
                placeholder={OS_REBOOT_DEFAULTS[form.os_type]}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={labelClass}>Notes (optionnel)</label>
            <textarea
              className={`${inputClass} resize-none h-20`}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Notes libres sur ce serveur..."
            />
          </div>

          {/* Organisation : tags, dossier, champs personnalisés */}
          <ServerOrganisationFields
            value={{ tag_ids: form.tag_ids ?? [], folder_id: form.folder_id ?? "", custom_fields: form.custom_fields ?? [] }}
            onChange={(patch) => { setForm((prev) => ({ ...prev, ...patch })); setErrors((e) => ({ ...e, custom_fields: "" })); }}
          />
          {errors.custom_fields && <p className={errorClass}>{errors.custom_fields}</p>}

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2 border-t border-border-primary">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all disabled:opacity-50"
            >
              {submitting ? "Enregistrement…" : initial ? "Mettre à jour" : "Ajouter"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Oubli de l'empreinte SSH mémorisée : à utiliser uniquement si le serveur a été
 * réinstallé (nouvelle clé d'hôte). La prochaine connexion mémorisera la nouvelle.
 */
function HostKeyReset({ serverId }: { serverId: string }) {
  const [state, setState] = useState<"idle" | "done" | "none" | "error">("idle");
  const [error, setError] = useState("");

  async function reset() {
    try {
      const removed = await invoke<boolean>("forget_host_key", { serverId });
      setState(removed ? "done" : "none");
    } catch (e) {
      setError(String(e));
      setState("error");
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 text-xs rounded-win border border-border-primary px-3 py-2">
      <span className="text-text-muted">
        {state === "done" && "Empreinte oubliée : la prochaine connexion mémorisera la nouvelle clé."}
        {state === "none" && "Aucune empreinte mémorisée pour ce serveur."}
        {state === "error" && <span className="text-red-400">{error}</span>}
        {state === "idle" && "Empreinte SSH mémorisée à la première connexion (protection contre l'usurpation)."}
      </span>
      {state === "idle" && (
        <button type="button" onClick={reset} className="shrink-0 text-accent-primary hover:underline">
          Réinitialiser
        </button>
      )}
    </div>
  );
}

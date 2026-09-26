import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Network as NetworkIcon, Loader2, Plus, Wand2, Cpu, List, GitFork } from "lucide-react";
import { useStore } from "../stores/useStore";
import { NetworkDevice, ServerPayload } from "../types";
import { ServerForm } from "../components/ServerForm";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { missingMacFixes } from "../utils/network";
import { useT } from "../i18n";
import { NetworkGraph } from "../components/NetworkGraph";
import { cn } from "../utils";

type NetworkView = "list" | "graph";

export function Network() {
  const { t } = useT();
  const { servers, statuses, addServer, updateServer } = useStore();
  const { toasts, removeToast, success, error } = useToast();
  const [devices, setDevices] = useState<NetworkDevice[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [adding, setAdding] = useState<NetworkDevice | null>(null);
  const [view, setView] = useState<NetworkView>("list");

  async function scan() {
    setScanning(true);
    try {
      setDevices(await invoke<NetworkDevice[]>("network_scan", { subnetOf: null }));
    } catch (e) {
      error(String(e));
    } finally {
      setScanning(false);
    }
  }

  const fixes = devices ? missingMacFixes(servers, devices) : [];

  /** Renseigne dans la config de l'app les MAC trouvées pour les serveurs qui n'en ont pas */
  async function applyFixes() {
    for (const { server, mac } of fixes) {
      const payload: ServerPayload = {
        name: server.name, ip: server.ip, mac_address: mac, ssh_user: server.ssh_user,
        ssh_password: "", // vide = mot de passe inchangé
        ssh_port: server.ssh_port, shutdown_command: server.shutdown_command, reboot_command: server.reboot_command,
        os_type: server.os_type, icon: server.icon, notes: server.notes,
      };
      try {
        await updateServer(server.id, payload);
      } catch (e) {
        error(t("network.serverError", { name: server.name, message: String(e) }));
      }
    }
    success(t("network.macsFilled", { count: fixes.length }));
  }

  return (
    <div className="p-6 space-y-6">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">{t("network.title")}</h1>
          <p className="text-text-secondary text-xs mt-0.5">{t("network.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-win border border-border-primary overflow-hidden text-xs">
            <button
              onClick={() => setView("list")}
              className={cn("flex items-center gap-1.5 px-3 py-1.5", view === "list" ? "bg-accent-primary text-white" : "text-text-secondary hover:bg-bg-hover")}
            >
              <List size={13} /> {t("network.viewList")}
            </button>
            <button
              onClick={() => setView("graph")}
              className={cn("flex items-center gap-1.5 px-3 py-1.5", view === "graph" ? "bg-accent-primary text-white" : "text-text-secondary hover:bg-bg-hover")}
            >
              <GitFork size={13} /> {t("network.viewGraph")}
            </button>
          </div>
          <button onClick={scan} disabled={scanning} className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-primary hover:bg-accent-secondary text-white rounded-win disabled:opacity-50">
            {scanning ? <Loader2 size={15} className="animate-spin" /> : <NetworkIcon size={15} />} {scanning ? t("network.scanning") : t("network.scan")}
          </button>
        </div>
      </div>

      {fixes.length > 0 && (
        <div className="flex items-center gap-3 bg-accent-primary/10 border border-accent-primary/30 rounded-win p-3 text-sm">
          <Wand2 size={16} className="text-accent-primary shrink-0" />
          <span className="flex-1 text-text-primary">
            {t("network.macFound", { servers: fixes.map((f) => f.server.name).join(", ") })}
          </span>
          <button onClick={applyFixes} className="px-3 py-1.5 text-xs rounded-win bg-accent-primary text-white hover:bg-accent-secondary">{t("network.fill")}</button>
        </div>
      )}

      {view === "graph" ? (
        <NetworkGraph servers={servers} statuses={statuses} devices={devices} onAddServer={setAdding} />
      ) : !devices ? (
        <div className="flex flex-col items-center gap-2 py-16 text-text-muted text-sm">
          <NetworkIcon size={28} className="opacity-50" />
          {t("network.empty")}
        </div>
      ) : (
        <div className="bg-bg-tertiary border border-border-primary rounded-win divide-y divide-border-secondary overflow-hidden">
          <p className="px-4 py-2 text-xs text-text-muted">{t("network.devices", { count: devices.length })}</p>
          {devices.map((d) => (
            <div key={d.ip} className="flex items-center gap-4 px-4 py-2 text-sm">
              <span className="font-mono text-text-primary w-32">{d.ip}</span>
              <span className="font-mono text-text-secondary w-40">{d.mac ?? "—"}</span>
              <span className="flex-1 min-w-0 truncate text-xs">
                {d.known_server && <span className="text-accent-success">{d.known_server}</span>}
                {d.virtual_nic && <span className="text-text-muted inline-flex items-center gap-1 ml-2"><Cpu size={11} />{d.virtual_nic}</span>}
              </span>
              {!d.known_server && (
                <button onClick={() => setAdding(d)} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-win border border-border-primary text-text-secondary hover:text-accent-primary hover:border-accent-primary/40">
                  <Plus size={12} /> {t("common.add")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <ServerForm
          prefill={{ ip: adding.ip, mac_address: adding.virtual_nic ? "" : adding.mac ?? "" }}
          onCancel={() => setAdding(null)}
          onSubmit={async (payload) => {
            await addServer(payload);
            setAdding(null);
            success(t("network.serverAdded", { name: payload.name }));
            setDevices((ds) => ds?.map((x) => (x.ip === payload.ip ? { ...x, known_server: payload.name } : x)) ?? null);
          }}
        />
      )}
    </div>
  );
}

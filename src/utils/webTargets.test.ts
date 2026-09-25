import { describe, it, expect } from "vitest";
import { webTargets } from "./webTargets";
import { ProxmoxConnection, Server } from "../types";

const srv = (id: string, name: string, ip: string, os_type: Server["os_type"]): Server => ({
  id, name, ip, os_type, mac_address: "", ssh_user: "root", ssh_password: "",
  ssh_port: 22, shutdown_command: "", reboot_command: "",
});

const conn: ProxmoxConnection = {
  id: "c1", name: "Datacenter", api_url: "http://192.168.50.53:8006/", token_id: "t", token_secret: "", verify_tls: false,
};

describe("webTargets", () => {
  it("liste les connexions Proxmox avec leur URL", () => {
    expect(webTargets([], [conn])).toEqual([
      { label: "c1", connectionId: "c1", url: "http://192.168.50.53:8006/", title: "Datacenter", kind: "Proxmox" },
    ]);
  });

  it("déduit l'interface web des serveurs Proxmox et TrueNAS", () => {
    const targets = webTargets([srv("p", "pve2", "10.0.0.2", "Proxmox"), srv("t", "nas", "10.0.0.5", "TrueNAS")], []);
    expect(targets.map((t) => [t.title, t.url])).toEqual([
      ["pve2", "https://10.0.0.2:8006/"],
      ["nas", "http://10.0.0.5/"],
    ]);
    // Label distinct de l'id brut du serveur : pas de collision avec une connexion Proxmox
    expect(targets[0].label).toBe("srv-p");
  });

  it("ignore les serveurs sans interface web connue", () => {
    expect(webTargets([srv("l", "debian", "10.0.0.3", "Linux"), srv("w", "win", "10.0.0.4", "Windows")], [])).toEqual([]);
  });

  it("n'affiche pas deux fois un nœud déjà couvert par une connexion Proxmox", () => {
    const targets = webTargets([srv("o", "minipc", "192.168.50.53", "Proxmox")], [conn]);
    expect(targets.map((t) => t.title)).toEqual(["Datacenter"]);
  });
});

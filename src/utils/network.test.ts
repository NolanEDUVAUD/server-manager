import { describe, it, expect } from "vitest";
import { buildTopology, eligibleParents, GATEWAY_ID, missingMacFixes, nodeKey } from "./network";
import { NetworkDevice, Server } from "../types";

const srv = (name: string, ip: string, mac = "") => ({ id: name, name, ip, mac_address: mac } as Server);

describe("missingMacFixes", () => {
  it("propose la MAC des serveurs qui n'en ont pas, sauf les cartes virtuelles", () => {
    const servers = [srv("minipc", "192.168.1.53"), srv("DockerHost", "192.168.1.54"), srv("workstation", "192.168.1.56", "02:00:00:00:00:03")];
    const devices = [
      { ip: "192.168.1.53", mac: "02:00:00:00:00:01", virtual_nic: null, known_server: "minipc" },
      { ip: "192.168.1.54", mac: "BC:24:11:00:00:02", virtual_nic: "VM Proxmox", known_server: "DockerHost" },
      { ip: "192.168.1.56", mac: "02:00:00:00:00:03", virtual_nic: null, known_server: "workstation" },
    ];
    expect(missingMacFixes(servers, devices).map((f) => [f.server.name, f.mac])).toEqual([["minipc", "02:00:00:00:00:01"]]);
  });

  it("ignore un serveur absent du scan", () => {
    expect(missingMacFixes([srv("nas", "192.168.1.50")], [])).toEqual([]);
  });
});

const dev = (ip: string, mac: string | null = null, extra: Partial<NetworkDevice> = {}): NetworkDevice => ({
  ip,
  mac,
  virtual_nic: null,
  known_server: null,
  vendor: null,
  device_kind: null,
  ...extra,
});

describe("buildTopology", () => {
  it("crée un nœud passerelle et rattache chaque serveur dessus par défaut", () => {
    const servers = [srv("minipc", "192.168.1.53")];
    const { nodes, edges } = buildTopology({ servers, statuses: {}, devices: null });
    expect(nodes.has(GATEWAY_ID)).toBe(true);
    expect(nodes.get("minipc")?.kind).toBe("server");
    expect(edges).toContainEqual({ source: "minipc", target: GATEWAY_ID });
  });

  it("ne duplique pas un appareil déjà représenté par un serveur (même IP)", () => {
    const servers = [srv("minipc", "192.168.1.53")];
    const devices = [dev("192.168.1.53", "02:00:00:00:00:01", { known_server: "minipc" })];
    const { nodes } = buildTopology({ servers, statuses: {}, devices });
    const deviceNodes = [...nodes.values()].filter((n) => n.kind === "device");
    expect(deviceNodes).toHaveLength(0);
  });

  it("ne duplique pas un appareil déjà représenté par un serveur (même MAC, IP différente)", () => {
    const servers = [srv("minipc", "192.168.1.53", "AA:BB:CC:DD:EE:FF")];
    // Le scan voit la même carte réseau à une autre IP (bail DHCP renouvelé)
    const devices = [dev("192.168.1.99", "AA:BB:CC:DD:EE:FF")];
    const { nodes } = buildTopology({ servers, statuses: {}, devices });
    const deviceNodes = [...nodes.values()].filter((n) => n.kind === "device" || n.kind === "switch" || n.kind === "ap");
    expect(deviceNodes).toHaveLength(0);
  });

  it("un serveur avec hôte de rebond passe par lui plutôt que par la passerelle", () => {
    const jump = srv("jump", "192.168.1.1");
    const behind = { ...srv("interne", "10.0.0.5"), jump_host_id: "jump" };
    const { edges } = buildTopology({ servers: [jump, behind], statuses: {}, devices: null });
    expect(edges).toContainEqual({ source: "interne", target: "jump" });
  });

  it("un override utilisateur (« Connecté via… ») prime sur le rattachement par défaut", () => {
    const servers = [srv("minipc", "192.168.1.53")];
    const overrides = { [nodeKey({ ip: "192.168.1.53" })]: { parentId: "mon-switch" } };
    const { nodes, edges } = buildTopology({ servers, statuses: {}, devices: null, overrides });
    expect(nodes.get("minipc")?.parentId).toBe("mon-switch");
    expect(edges).toContainEqual({ source: "minipc", target: "mon-switch" });
  });

  it("un switch/AP virtuel ajouté manuellement apparaît dans le graphe, relié à son parent", () => {
    const { nodes, edges } = buildTopology({
      servers: [],
      statuses: {},
      devices: null,
      virtualNodes: [{ id: "sw1", label: "Switch garage", kind: "switch", parentId: GATEWAY_ID }],
    });
    expect(nodes.get("sw1")).toMatchObject({ kind: "switch", virtual: true });
    expect(edges).toContainEqual({ source: "sw1", target: GATEWAY_ID });
  });

  it("devine un appareil détecté comme point d'accès d'après son nom/fabricant", () => {
    const devices = [dev("192.168.1.10", null, { known_server: "UniFi-AP-Salon", vendor: "Ubiquiti" })];
    const { nodes } = buildTopology({ servers: [], statuses: {}, devices });
    const apNode = [...nodes.values()].find((n) => n.ip === "192.168.1.10");
    expect(apNode?.kind).toBe("ap");
  });

  it("ajoute un nœud Wi-Fi relié à la passerelle quand des infos WLAN sont fournies", () => {
    const { nodes, edges } = buildTopology({
      servers: [],
      statuses: {},
      devices: null,
      wlan: { ssid: "MonReseau", bssid: "00:11:22:33:44:55", signal_percent: 80, channel: 44, band: "5 GHz" },
    });
    const ap = [...nodes.values()].find((n) => n.kind === "ap" && n.label === "MonReseau");
    expect(ap).toBeDefined();
    expect(edges).toContainEqual({ source: ap!.id, target: GATEWAY_ID });
  });

  it("ajoute un cluster par sous-réseau supplémentaire (VPN, route statique)", () => {
    const { nodes } = buildTopology({
      servers: [],
      statuses: {},
      devices: null,
      extraSubnets: [{ destination: "10.6.0.0", mask: "255.255.0.0", gateway: null, interface: "10.6.0.1", metric: 58 }],
    });
    expect([...nodes.values()].some((n) => n.kind === "subnet" && n.label === "10.6.0.0")).toBe(true);
  });
});

describe("eligibleParents", () => {
  it("exclut le nœud lui-même et ses descendants (pas de cycle)", () => {
    const servers = [srv("a", "10.0.0.1"), { ...srv("b", "10.0.0.2"), jump_host_id: "a" }];
    const { nodes } = buildTopology({ servers, statuses: {}, devices: null });
    const candidates = eligibleParents(nodes, "a").map((n) => n.id);
    expect(candidates).not.toContain("a");
    expect(candidates).not.toContain("b"); // b dépend de a : le choisir créerait un cycle
    expect(candidates).toContain(GATEWAY_ID);
  });
});

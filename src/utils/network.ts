import { DeviceKind, NetworkDevice, RouteEntry, Server, ServerStatus, TracerouteHop, WlanInfo } from "../types";

/**
 * Serveurs sans MAC pour lesquels le scan en a trouvé une utilisable
 * (les cartes virtuelles sont exclues : le WoL ne démarre pas une VM).
 */
export function missingMacFixes(servers: Server[], devices: NetworkDevice[]): { server: Server; mac: string }[] {
  return servers
    .filter((s) => !s.mac_address)
    .map((s) => ({ server: s, device: devices.find((d) => d.ip === s.ip) }))
    .filter((x): x is { server: Server; device: NetworkDevice } => !!x.device?.mac && !x.device.virtual_nic)
    .map(({ server, device }) => ({ server, mac: device.mac! }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Topologie du graphe réseau (vue « façon Obsidian »)
// ─────────────────────────────────────────────────────────────────────────────

export type GraphNodeKind = "gateway" | "server" | "device" | "ap" | "switch" | "subnet" | "internet";
export type GraphNodeStatus = "online" | "offline" | "unknown";

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  status: GraphNodeStatus;
  ip?: string | null;
  mac?: string | null;
  vendor?: string | null;
  deviceType?: DeviceKind | null;
  /** Latence de la dernière requête (ms), quand connue (serveurs suivis) */
  latencyMs?: number | null;
  /** Horodatage (ms) du dernier ping reçu — sert de « dernière vue » dans le panneau */
  lastSeen?: number | null;
  /** Identifiant du serveur connu correspondant (pour ouvrir sa fiche) */
  serverId?: string | null;
  /** Nœud dont ce serveur dépend (hôte de rebond) */
  jumpVia?: string | null;
  /** Nœud parent effectif dans la topologie affichée (calculé, pas forcément l'override) */
  parentId?: string | null;
  /** Un nœud infra ajouté manuellement (switch/AP virtuel), pas un appareil détecté */
  virtual?: boolean;
  /** Nombre de sauts jusqu'à ce nœud (Internet), quand connu via le traceroute */
  hops?: number | null;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export const GATEWAY_ID = "__gateway__";
export const AP_ID = "__ap__";
export const INTERNET_ID = "__internet__";

/** Clé stable d'un appareil : la MAC si on l'a (identifie la carte réseau, même si
 * l'IP change au DHCP), sinon l'IP. Utilisée pour dédupliquer et pour retrouver un
 * override de topologie enregistré. */
export function nodeKey(d: { mac?: string | null; ip: string }): string {
  return d.mac ? `mac:${d.mac.toUpperCase()}` : `ip:${d.ip}`;
}

export interface TopologyOverride {
  parentId: string | null;
}

export interface VirtualInfraNode {
  id: string;
  label: string;
  kind: "switch" | "ap";
  parentId: string | null;
}

export interface BuildTopologyInput {
  servers: Server[];
  statuses: Record<string, ServerStatus>;
  devices: NetworkDevice[] | null;
  /** Overrides utilisateur (« Connecté via… »), clé = `nodeKey` */
  overrides?: Record<string, TopologyOverride>;
  /** Switchs/AP virtuels ajoutés manuellement */
  virtualNodes?: VirtualInfraNode[];
  routes?: RouteEntry[] | null;
  extraSubnets?: RouteEntry[] | null;
  wlan?: WlanInfo | null;
  tracerouteHops?: TracerouteHop[] | null;
}

const INFRA_HINT = /switch|commutateur|\bap\b|access.?point|point.?d.?acc[eè]s|unifi/i;

/** Un appareil détecté (pas déjà un serveur connu) ressemble-t-il à une brique
 * d'infrastructure (switch/AP) d'après son fabricant ou son nom ? Heuristique
 * volontairement large : faute de LLDP/SNMP, mieux vaut suggérer que se taire. */
function looksLikeInfra(vendor: string | null | undefined, label: string): "switch" | "ap" | null {
  const hay = `${vendor ?? ""} ${label}`;
  if (!INFRA_HINT.test(hay)) return null;
  if (/ap\b|access.?point|point.?d.?acc[eè]s|unifi/i.test(hay)) return "ap";
  return "switch";
}

/**
 * Construit les nœuds et arêtes du graphe à partir des serveurs connus, des
 * appareils détectés par le dernier scan, de la table de routage/Wi-Fi (si
 * fournie) et des overrides de topologie posés par l'utilisateur.
 *
 * Règles :
 * - un même appareil vu à la fois comme serveur connu et comme appareil détecté
 *   (même IP ou même MAC) n'est représenté qu'une seule fois ;
 * - le parent par défaut est la passerelle, sauf hôte de rebond explicite (serveur)
 *   ou override utilisateur, qui priment toujours ;
 * - un appareil qui ressemble à un switch/AP (fabricant/nom) est affiché comme tel,
 *   mais ne devient pas automatiquement le parent d'autres appareils (pas de vraie
 *   découverte L2) : seul un override utilisateur explicite le fait.
 */
export function buildTopology(input: BuildTopologyInput): { nodes: Map<string, GraphNode>; edges: GraphEdge[] } {
  const { servers, statuses, devices, overrides = {}, virtualNodes = [], extraSubnets, wlan, tracerouteHops } = input;
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const gatewayIp = input.routes?.find((r) => r.destination === "0.0.0.0")?.gateway ?? null;
  nodes.set(GATEWAY_ID, { id: GATEWAY_ID, label: "gateway", kind: "gateway", status: "online", ip: gatewayIp });

  // ── Wi-Fi : l'AP de l'hôte, relié à la passerelle ──────────────────────────
  if (wlan?.ssid || wlan?.bssid) {
    nodes.set(AP_ID, {
      id: AP_ID,
      label: wlan.ssid ?? wlan.bssid ?? "Wi-Fi",
      kind: "ap",
      status: "online",
      mac: wlan.bssid ?? null,
      parentId: GATEWAY_ID,
    });
    edges.push({ source: AP_ID, target: GATEWAY_ID });
  }

  // ── Internet, via le traceroute (nombre de sauts, pas chaque relais du FAI) ─
  if (tracerouteHops && tracerouteHops.some((h) => h.ip)) {
    nodes.set(INTERNET_ID, { id: INTERNET_ID, label: "internet", kind: "internet", status: "online", hops: tracerouteHops.length });
    edges.push({ source: GATEWAY_ID, target: INTERNET_ID });
  }

  // ── Sous-réseaux supplémentaires (VPN, routes statiques) en clusters à part ─
  for (const r of extraSubnets ?? []) {
    const id = `subnet:${r.destination}`;
    nodes.set(id, { id, label: r.destination, kind: "subnet", status: "online", parentId: GATEWAY_ID });
    edges.push({ source: id, target: GATEWAY_ID });
  }

  // ── Switchs/AP virtuels ajoutés manuellement ────────────────────────────────
  for (const v of virtualNodes) {
    nodes.set(v.id, { id: v.id, label: v.label, kind: v.kind, status: "unknown", virtual: true, parentId: v.parentId ?? GATEWAY_ID });
  }
  for (const v of virtualNodes) {
    edges.push({ source: v.id, target: v.parentId ?? GATEWAY_ID });
  }

  // ── Serveurs connus ─────────────────────────────────────────────────────────
  // Un appareil détecté est un doublon d'un serveur s'il partage sa MAC *ou* son
  // IP (une IP suffit : beaucoup de serveurs n'ont pas de MAC enregistrée) — d'où
  // deux identifiants par serveur plutôt qu'une seule clé « préférée ».
  const serverIdentifiers = new Set<string>();
  for (const s of servers) {
    serverIdentifiers.add(`ip:${s.ip}`);
    if (s.mac_address) serverIdentifiers.add(`mac:${s.mac_address.toUpperCase()}`);
  }
  for (const s of servers) {
    const key = nodeKey({ mac: s.mac_address || null, ip: s.ip });
    const st = statuses[s.id];
    const defaultParent = s.jump_host_id && servers.some((j) => j.id === s.jump_host_id) ? s.jump_host_id : GATEWAY_ID;
    const parentId = overrides[key]?.parentId ?? defaultParent;
    nodes.set(s.id, {
      id: s.id,
      label: s.name,
      kind: "server",
      status: st ? (st.online ? "online" : "offline") : "unknown",
      ip: s.ip,
      mac: s.mac_address || null,
      serverId: s.id,
      latencyMs: st?.latency_ms ?? null,
      lastSeen: st?.last_checked ?? null,
      jumpVia: s.jump_host_id ? servers.find((j) => j.id === s.jump_host_id)?.name ?? null : null,
      parentId,
    });
    edges.push({ source: s.id, target: parentId });
  }

  // ── Appareils détectés, hors doublons d'un serveur déjà représenté ──────────
  const seenDeviceKeys = new Set<string>();
  for (const d of devices ?? []) {
    const key = nodeKey(d);
    const deviceIdentifiers = [`ip:${d.ip}`, ...(d.mac ? [`mac:${d.mac.toUpperCase()}`] : [])];
    if (deviceIdentifiers.some((id) => serverIdentifiers.has(id)) || seenDeviceKeys.has(key)) continue; // déjà représenté (serveur, ou doublon MAC/IP du scan)
    seenDeviceKeys.add(key);

    const id = `device:${key}`;
    const label = d.known_server ?? d.ip;
    const infra = looksLikeInfra(d.vendor, `${label} ${d.mac ?? ""}`);
    const kind: GraphNodeKind = infra === "ap" ? "ap" : infra === "switch" ? "switch" : "device";
    const parentId = overrides[key]?.parentId ?? GATEWAY_ID;
    nodes.set(id, {
      id,
      label,
      kind,
      status: "online", // un appareil listé par le scan a répondu au ping
      ip: d.ip,
      mac: d.mac,
      vendor: d.vendor ?? null,
      deviceType: d.device_kind ?? null,
      parentId,
    });
    edges.push({ source: id, target: parentId });
  }

  return { nodes, edges };
}

/** Toutes les clés (`nodeKey`) éligibles comme parent dans le sélecteur « Connecté
 * via… » — tout nœud du graphe sauf soi-même et ses propres descendants (pas de
 * cycle). */
export function eligibleParents(nodes: Map<string, GraphNode>, excludeId: string): GraphNode[] {
  const descendants = new Set<string>([excludeId]);
  // Propage : tout nœud dont le parent est déjà marqué descendant l'est aussi
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes.values()) {
      if (n.parentId && descendants.has(n.parentId) && !descendants.has(n.id)) {
        descendants.add(n.id);
        changed = true;
      }
    }
  }
  return [...nodes.values()].filter((n) => !descendants.has(n.id));
}

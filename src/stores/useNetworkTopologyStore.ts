/**
 * Topologie du graphe réseau posée par l'utilisateur : à qui un appareil est
 * « connecté via… » (switch, box, autre serveur…), et les switchs/AP virtuels
 * ajoutés à la main quand ils n'apparaissent pas dans le scan (pas de vraie
 * découverte L2 possible sans SNMP/LLDP). Persisté dans localStorage (par
 * appareil, jamais partagé) via le middleware `persist` de zustand — le plus
 * simple et robuste ici : pas de nouvelle commande Tauri, pas de migration de
 * `data.json` à gérer côté Rust pour un réglage purement cosmétique du graphe.
 *
 * Les overrides sont indexés par `nodeKey` (voir `utils/network.ts`, MAC de
 * préférence sinon IP) : stable d'un scan à l'autre, contrairement à
 * `device:<ip>` si l'appareil change d'IP au DHCP.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { TopologyOverride, VirtualInfraNode } from "../utils/network";

/** localStorage n'est pas toujours disponible (navigation privée, tests…) : jamais bloquant */
function safeStorage() {
  const memory = new Map<string, string>();
  return {
    getItem(name: string): string | null {
      try {
        return localStorage.getItem(name);
      } catch {
        return memory.get(name) ?? null;
      }
    },
    setItem(name: string, value: string) {
      try {
        localStorage.setItem(name, value);
      } catch {
        memory.set(name, value);
      }
    },
    removeItem(name: string) {
      try {
        localStorage.removeItem(name);
      } catch {
        memory.delete(name);
      }
    },
  };
}

interface NetworkTopologyState {
  /** Clé (`nodeKey`) → parent choisi */
  overrides: Record<string, TopologyOverride>;
  /** Switchs/AP virtuels ajoutés manuellement */
  virtualNodes: VirtualInfraNode[];

  setParent: (key: string, parentId: string | null) => void;
  clearOverride: (key: string) => void;
  addVirtualNode: (label: string, kind: "switch" | "ap", parentId?: string | null) => VirtualInfraNode;
  setVirtualNodeParent: (id: string, parentId: string | null) => void;
  removeVirtualNode: (id: string) => void;
}

export const useNetworkTopologyStore = create<NetworkTopologyState>()(
  persist(
    (set) => ({
      overrides: {},
      virtualNodes: [],

      setParent: (key, parentId) =>
        set((s) => ({ overrides: { ...s.overrides, [key]: { parentId } } })),
      clearOverride: (key) =>
        set((s) => {
          const { [key]: _removed, ...rest } = s.overrides;
          return { overrides: rest };
        }),
      addVirtualNode: (label, kind, parentId = null) => {
        const node: VirtualInfraNode = { id: `virtual:${crypto.randomUUID()}`, label, kind, parentId };
        set((s) => ({ virtualNodes: [...s.virtualNodes, node] }));
        return node;
      },
      setVirtualNodeParent: (id, parentId) =>
        set((s) => ({ virtualNodes: s.virtualNodes.map((n) => (n.id === id ? { ...n, parentId } : n)) })),
      removeVirtualNode: (id) =>
        set((s) => ({
          virtualNodes: s.virtualNodes.filter((n) => n.id !== id),
          // Les nœuds rattachés à ce switch/AP virtuel retombent sur la passerelle
          overrides: Object.fromEntries(
            Object.entries(s.overrides).map(([k, v]) => [k, v.parentId === id ? { parentId: null } : v])
          ),
        })),
    }),
    {
      name: "network-topology",
      storage: createJSONStorage(safeStorage),
    }
  )
);

import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Crosshair, HardDrive, Plus, Printer, Router, Server as ServerIcon, Smartphone, Trash2, Tv, Wifi, X } from "lucide-react";
import { useT } from "../i18n";
import { DeviceKind, NetworkDevice, RouteEntry, Server, ServerStatus, TracerouteHop, WlanInfo } from "../types";
import {
  ALPHA_MIN,
  circularLayout,
  computeFitTransform,
  decayAlpha,
  INITIAL_ALPHA,
  simulate,
  LayoutEdge,
  LayoutNode,
  stepForceLayout,
  ViewTransform,
} from "../utils/forceLayout";
import { buildTopology, eligibleParents, GATEWAY_ID, GraphNode, GraphNodeKind, nodeKey } from "../utils/network";
import { useNetworkTopologyStore } from "../stores/useNetworkTopologyStore";

const STATUS_COLOR: Record<GraphNode["status"], string> = {
  online: "#4ade80",
  offline: "#f87171",
  unknown: "#94a3b8",
};

/** Rayon (px) selon le rôle du nœud — les briques d'infra ressortent un peu plus */
function radiusFor(kind: GraphNodeKind): number {
  switch (kind) {
    case "gateway":
      return 16;
    case "internet":
      return 15;
    case "switch":
    case "ap":
    case "subnet":
      return 13;
    default:
      return 10;
  }
}

const KIND_ICON: Partial<Record<string, typeof Router>> = {
  router: Router,
  switch: Router,
  access_point: Wifi,
  server: ServerIcon,
  nas: HardDrive,
  phone: Smartphone,
  tv: Tv,
  printer: Printer,
};

/** Distance (px) minimale forcée entre deux nœuds — suffit à garder les étiquettes lisibles */
const COLLISION_RADIUS = 46;
const MIN_SCALE = 0.15;
const MAX_SCALE = 3;

interface NetworkGraphProps {
  servers: Server[];
  statuses: Record<string, ServerStatus>;
  devices: NetworkDevice[] | null;
  /** Pré-remplit le formulaire d'ajout de serveur avec cet appareil détecté */
  onAddServer?: (device: NetworkDevice) => void;
}

export function NetworkGraph({ servers, statuses, devices, onAddServer }: NetworkGraphProps) {
  const { t } = useT();
  const navigate = useNavigate();
  const { overrides, virtualNodes, setParent, addVirtualNode, removeVirtualNode } = useNetworkTopologyStore();

  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 480 });
  const [, forceRerender] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<ViewTransform>({ tx: 0, ty: 0, scale: 1 });
  const [addingVirtual, setAddingVirtual] = useState<"switch" | "ap" | null>(null);
  const [virtualLabel, setVirtualLabel] = useState("");

  // ── Détection réseau annexe (routes, Wi-Fi, traceroute) : facultative, best
  // effort — un échec (pas de Tauri en dev web, permissions manquantes…) ne doit
  // jamais casser le graphe, juste priver les nœuds passerelle/Wi-Fi/Internet
  // d'informations supplémentaires.
  const [routes, setRoutes] = useState<RouteEntry[] | null>(null);
  const [extraSubnets, setExtraSubnets] = useState<RouteEntry[] | null>(null);
  const [wlan, setWlan] = useState<WlanInfo | null>(null);
  const [tracerouteHops, setTracerouteHops] = useState<TracerouteHop[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<RouteEntry[]>("get_routes").then((r) => !cancelled && setRoutes(r)).catch(() => {});
    invoke<RouteEntry[]>("get_extra_subnets").then((r) => !cancelled && setExtraSubnets(r)).catch(() => {});
    invoke<WlanInfo | null>("get_wlan_info").then((w) => !cancelled && setWlan(w)).catch(() => {});
    invoke<TracerouteHop[]>("traceroute_lite", { target: null }).then((h) => !cancelled && setTracerouteHops(h)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const { nodes: nodesData, edges } = useMemo(
    () => buildTopology({ servers, statuses, devices, overrides, virtualNodes, routes, extraSubnets, wlan, tracerouteHops }),
    [servers, statuses, devices, overrides, virtualNodes, routes, extraSubnets, wlan, tracerouteHops]
  );

  // Les positions vivent dans une ref (mutées à chaque frame par la simulation) :
  // on ne veut pas re-render 60x/s via setState, juste peindre le SVG.
  const nodesRef = useRef<LayoutNode[]>([]);
  const draggingRef = useRef<{ id: string; pointerId: number; moved: boolean } | null>(null);
  const panningRef = useRef<{ x: number; y: number; tx: number; ty: number; pointerId: number } | null>(null);
  const alphaRef = useRef(INITIAL_ALPHA);
  const rafRef = useRef(0);
  const shouldFitRef = useRef(true);
  const edgesRef = useRef<LayoutEdge[]>(edges);
  edgesRef.current = edges;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ width: Math.max(r.width, 200), height: Math.max(r.height, 200) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Redémarre la simulation (nœuds « réchauffés ») après un redimensionnement,
  // sans quoi elle resterait figée à l'échelle précédente
  useEffect(() => {
    alphaRef.current = INITIAL_ALPHA;
    startLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  // Réinitialise les positions quand l'ensemble de nœuds change (id ajouté/retiré),
  // en conservant la position des nœuds déjà présents (pas de saut visuel au
  // prochain scan) — seuls les nœuds réellement nouveaux démarrent en cercle.
  useEffect(() => {
    const ids = [...nodesData.keys()];
    const existing = new Map(nodesRef.current.map((n) => [n.id, n]));
    const isNewSet = ids.some((id) => !existing.has(id)) || ids.length !== nodesRef.current.length;
    // Les nouveaux nœuds sont répartis ENSEMBLE sur un cercle : placés un par un, ils
    // démarreraient tous au même point et la répulsion les projetterait au hasard.
    const newIds = ids.filter((id) => !existing.has(id));
    const placed = new Map(circularLayout(newIds, size.width, size.height, 140).map((n) => [n.id, n]));
    nodesRef.current = ids.map((id) => existing.get(id) ?? placed.get(id)!);
    const gateway = nodesRef.current.find((n) => n.id === GATEWAY_ID);
    if (gateway && !existing.has(GATEWAY_ID)) {
      gateway.x = size.width / 2;
      gateway.y = size.height / 2;
    }
    if (isNewSet) {
      alphaRef.current = INITIAL_ALPHA;
      shouldFitRef.current = true;
      // Premier affichage : on pré-calcule la mise en place hors écran pour que le graphe
      // apparaisse déjà presque stable (l'animation ne fait plus que l'affiner)
      if (existing.size === 0) {
        simulate(nodesRef.current, edgesRef.current, { width: size.width, height: size.height, collisionRadius: COLLISION_RADIUS, alpha: 1 }, 300);
        alphaRef.current = 0.3;
      }
    }
    if (selected && !nodesData.has(selected)) setSelected(null);
    startLoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesData]);

  useEffect(() => stopLoop, []);

  function stopLoop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }

  /** Fait avancer la simulation jusqu'à stabilisation (alpha proche de 0), puis
   * arrête la boucle : plus de tremblement perpétuel (jitter), et le CPU/GPU ne
   * tourne pas pour rien une fois le graphe posé — important à 200+ nœuds. */
  function startLoop() {
    if (rafRef.current) return;
    const tick = () => {
      const interacting = !!draggingRef.current || !!panningRef.current;
      for (const n of nodesRef.current) n.fixed = draggingRef.current?.id === n.id;
      stepForceLayout(nodesRef.current, edgesRef.current, {
        width: sizeRef.current.width,
        height: sizeRef.current.height,
        collisionRadius: COLLISION_RADIUS,
        alpha: alphaRef.current,
      });
      if (!interacting) alphaRef.current = decayAlpha(alphaRef.current);
      forceRerender((x) => (x + 1) % 1000000);

      const settled = alphaRef.current <= ALPHA_MIN && !interacting;
      if (settled && shouldFitRef.current) {
        setView(computeFitTransform(nodesRef.current, sizeRef.current.width, sizeRef.current.height));
        shouldFitRef.current = false;
      }
      if (settled) {
        rafRef.current = 0;
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  const toGraphPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    };
  };

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    panningRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, pointerId: e.pointerId };
    setSelected(null);
  };

  const onNodePointerDown = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    draggingRef.current = { id, pointerId: e.pointerId, moved: false };
    alphaRef.current = Math.max(alphaRef.current, 0.3); // réchauffe un peu : les voisins réagissent au déplacement
    startLoop();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (draggingRef.current && draggingRef.current.pointerId === e.pointerId) {
      draggingRef.current.moved = true;
      const p = toGraphPoint(e.clientX, e.clientY);
      const n = nodesRef.current.find((x) => x.id === draggingRef.current!.id);
      if (n) {
        n.x = p.x;
        n.y = p.y;
      }
    } else if (panningRef.current && panningRef.current.pointerId === e.pointerId) {
      const dx = e.clientX - panningRef.current.x;
      const dy = e.clientY - panningRef.current.y;
      setView((v) => ({ ...v, tx: panningRef.current!.tx + dx, ty: panningRef.current!.ty + dy }));
    }
  };

  const endInteraction = (e: React.PointerEvent) => {
    if (draggingRef.current?.pointerId === e.pointerId) {
      const wasClick = !draggingRef.current.moved;
      const id = draggingRef.current.id;
      draggingRef.current = null;
      if (wasClick) setSelected(id);
      startLoop();
    }
    if (panningRef.current?.pointerId === e.pointerId) panningRef.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      // Le point du graphe sous le curseur doit rester sous le curseur après le zoom
      const gx = (cursorX - v.tx) / v.scale;
      const gy = (cursorY - v.ty) / v.scale;
      return { scale, tx: cursorX - gx * scale, ty: cursorY - gy * scale };
    });
  };

  function recenter() {
    setView(computeFitTransform(nodesRef.current, size.width, size.height));
  }

  const selectedData = selected ? nodesData.get(selected) : null;
  const selectedPos = selected ? nodesRef.current.find((n) => n.id === selected) : null;
  const selectedOverrideKey = selectedData && !selectedData.virtual && selectedData.ip ? nodeKey({ mac: selectedData.mac, ip: selectedData.ip }) : null;

  const kindLabel = (kind: GraphNodeKind) =>
    kind === "gateway"
      ? t("network.nodeGateway")
      : kind === "server"
      ? t("network.nodeServer")
      : kind === "ap"
      ? t("network.nodeAp")
      : kind === "switch"
      ? t("network.nodeSwitch")
      : kind === "subnet"
      ? t("network.nodeSubnet")
      : kind === "internet"
      ? t("network.nodeInternet")
      : t("network.nodeDevice");

  function deviceKindLabel(kind: DeviceKind): string {
    switch (kind) {
      case "router":
        return t("network.deviceKind.router");
      case "switch":
        return t("network.deviceKind.switch");
      case "access_point":
        return t("network.deviceKind.access_point");
      case "server":
        return t("network.deviceKind.server");
      case "nas":
        return t("network.deviceKind.nas");
      case "phone":
        return t("network.deviceKind.phone");
      case "tv":
        return t("network.deviceKind.tv");
      case "printer":
        return t("network.deviceKind.printer");
      case "iot":
        return t("network.deviceKind.iot");
      default:
        return t("network.deviceKind.unknown");
    }
  }

  /** Chemin (nœud → … → passerelle), pour afficher le nombre de sauts et la route */
  function connectionPath(node: GraphNode): GraphNode[] {
    const path: GraphNode[] = [node];
    let current: GraphNode | undefined = node;
    const seen = new Set([node.id]);
    while (current?.parentId && !seen.has(current.parentId)) {
      const parent = nodesData.get(current.parentId);
      if (!parent) break;
      path.push(parent);
      seen.add(parent.id);
      current = parent;
    }
    return path;
  }

  const originalDevice = selectedData?.ip ? devices?.find((d) => d.ip === selectedData.ip) ?? null : null;

  return (
    <div className="relative bg-bg-tertiary border border-border-primary rounded-win overflow-hidden" style={{ height: 480 }}>
      <svg
        ref={svgRef}
        className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endInteraction}
        onPointerCancel={endInteraction}
        onWheel={onWheel}
      >
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
          {edges.map((e, i) => {
            const a = nodesRef.current.find((n) => n.id === e.source);
            const b = nodesRef.current.find((n) => n.id === e.target);
            if (!a || !b) return null;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border-primary)" strokeWidth={1.5} />;
          })}
          {nodesRef.current.map((n) => {
            const data = nodesData.get(n.id);
            if (!data) return null;
            const radius = radiusFor(data.kind);
            const Icon = data.deviceType ? KIND_ICON[data.deviceType] : undefined;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x} ${n.y})`}
                onPointerDown={onNodePointerDown(n.id)}
                className="cursor-pointer"
              >
                <title>{data.label}</title>
                <circle
                  r={radius}
                  fill={STATUS_COLOR[data.status]}
                  stroke={selected === n.id ? "var(--accent-primary)" : "var(--bg-primary)"}
                  strokeWidth={selected === n.id ? 3 : 2}
                />
                {Icon && (
                  <Icon x={-6} y={-6} width={12} height={12} color="var(--bg-primary)" strokeWidth={2.5} />
                )}
                <text y={radius + 12} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
                  {data.kind === "gateway" ? t("network.gateway") : data.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute bottom-2 left-2 flex items-center gap-2">
        <p className="text-[11px] text-text-muted bg-bg-primary/70 px-2 py-1 rounded pointer-events-none">
          {t("network.graphHint")}
        </p>
      </div>

      <div className="absolute top-2 left-2 flex items-center gap-1.5">
        <button
          onClick={recenter}
          title={t("network.recenter")}
          className="flex items-center gap-1 px-2 py-1.5 text-[11px] rounded-win bg-bg-primary/80 border border-border-primary text-text-secondary hover:text-accent-primary hover:border-accent-primary/40"
        >
          <Crosshair size={12} /> {t("network.recenter")}
        </button>
        <button
          onClick={() => setAddingVirtual("switch")}
          title={t("network.addVirtualNode")}
          className="flex items-center gap-1 px-2 py-1.5 text-[11px] rounded-win bg-bg-primary/80 border border-border-primary text-text-secondary hover:text-accent-primary hover:border-accent-primary/40"
        >
          <Plus size={12} /> {t("network.addVirtualNode")}
        </button>
      </div>

      {addingVirtual && (
        <div className="absolute top-11 left-2 w-60 bg-bg-secondary border border-border-primary rounded-win shadow-win-hover p-3 text-xs space-y-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setAddingVirtual("switch")}
              className={`flex-1 px-2 py-1 rounded-win border ${addingVirtual === "switch" ? "border-accent-primary text-accent-primary" : "border-border-primary text-text-secondary"}`}
            >
              {t("network.virtualNodeKindSwitch")}
            </button>
            <button
              onClick={() => setAddingVirtual("ap")}
              className={`flex-1 px-2 py-1 rounded-win border ${addingVirtual === "ap" ? "border-accent-primary text-accent-primary" : "border-border-primary text-text-secondary"}`}
            >
              {t("network.virtualNodeKindAp")}
            </button>
          </div>
          <input
            autoFocus
            value={virtualLabel}
            onChange={(e) => setVirtualLabel(e.target.value)}
            placeholder={t("network.virtualNodeName")}
            className="w-full px-2 py-1 bg-bg-tertiary border border-border-primary rounded-win text-text-primary"
          />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { setAddingVirtual(null); setVirtualLabel(""); }} className="text-text-muted hover:text-text-primary">
              {t("common.cancel")}
            </button>
            <button
              disabled={!virtualLabel.trim()}
              onClick={() => {
                addVirtualNode(virtualLabel.trim(), addingVirtual);
                setAddingVirtual(null);
                setVirtualLabel("");
              }}
              className="px-2.5 py-1 rounded-win bg-accent-primary text-white disabled:opacity-50"
            >
              {t("network.virtualNodeAdd")}
            </button>
          </div>
        </div>
      )}

      {selectedData && selectedPos && (
        <div className="absolute top-2 right-2 w-64 max-h-[440px] overflow-y-auto bg-bg-secondary border border-border-primary rounded-win shadow-win-hover p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-text-primary font-medium truncate">{selectedData.label}</p>
            <button onClick={() => setSelected(null)} className="text-text-muted hover:text-text-primary shrink-0" aria-label={t("network.closeDetails")}>
              <X size={13} />
            </button>
          </div>

          <p className="text-text-secondary">
            {t("network.nodeDetails.type")}: <span className="text-text-primary">{kindLabel(selectedData.kind)}</span>
          </p>
          <p className="text-text-secondary">
            {t("network.nodeDetails.status")}:{" "}
            <span style={{ color: STATUS_COLOR[selectedData.status] }}>
              {selectedData.status === "online" ? t("network.statusOnline") : selectedData.status === "offline" ? t("network.statusOffline") : t("network.statusUnknown")}
            </span>
          </p>
          {selectedData.ip && (
            <p className="text-text-secondary">{t("network.nodeDetails.ip")}: <span className="font-mono text-text-primary">{selectedData.ip}</span></p>
          )}
          {selectedData.mac && (
            <p className="text-text-secondary">{t("network.nodeDetails.mac")}: <span className="font-mono text-text-primary">{selectedData.mac}</span></p>
          )}
          {selectedData.vendor && (
            <p className="text-text-secondary">{t("network.nodeDetails.vendor")}: <span className="text-text-primary">{selectedData.vendor}</span></p>
          )}
          {selectedData.deviceType && (
            <p className="text-text-secondary">
              {t("network.nodeDetails.deviceType")}: <span className="text-text-primary">{deviceKindLabel(selectedData.deviceType)}</span>
            </p>
          )}
          {selectedData.latencyMs != null && (
            <p className="text-text-secondary">{t("network.nodeDetails.latency")}: <span className="text-text-primary">{t("network.nodeDetails.latencyValue", { latency: selectedData.latencyMs })}</span></p>
          )}
          {selectedData.kind === "server" && (
            <p className="text-text-secondary">
              {t("network.nodeDetails.lastSeen")}:{" "}
              <span className="text-text-primary">{selectedData.lastSeen ? new Date(selectedData.lastSeen).toLocaleString() : t("network.nodeDetails.never")}</span>
            </p>
          )}
          {selectedData.jumpVia && (
            <p className="text-text-secondary">{t("network.nodeDetails.jumpVia")}: <span className="text-text-primary">{selectedData.jumpVia}</span></p>
          )}
          {selectedData.hops != null && (
            <p className="text-text-secondary flex items-center gap-1"><AlertTriangle size={11} className="text-accent-warning shrink-0" />{t("network.hops", { count: selectedData.hops })}</p>
          )}

          <div className="pt-1 border-t border-border-secondary">
            <p className="text-text-secondary mb-1">{t("network.nodeDetails.connectionPath")}</p>
            <p className="text-text-primary truncate">
              {connectionPath(selectedData)
                .map((n) => n.label)
                .join(" → ")}
            </p>
          </div>

          {selectedData.virtual ? (
            <button
              onClick={() => {
                removeVirtualNode(selectedData.id);
                setSelected(null);
              }}
              className="w-full flex items-center justify-center gap-1.5 mt-1 px-2.5 py-1.5 rounded-win border border-accent-error/40 text-accent-error hover:bg-accent-error/10"
            >
              <Trash2 size={12} /> {t("network.virtualNodeRemove")}
            </button>
          ) : (
            selectedOverrideKey &&
            selectedData.kind !== "gateway" &&
            selectedData.kind !== "internet" && (
              <div className="pt-1 border-t border-border-secondary">
                <label className="text-text-secondary block mb-1">{t("network.nodeDetails.connectedVia")}</label>
                <select
                  value={selectedData.parentId ?? GATEWAY_ID}
                  onChange={(e) => setParent(selectedOverrideKey, e.target.value === GATEWAY_ID ? null : e.target.value)}
                  className="w-full px-2 py-1 bg-bg-tertiary border border-border-primary rounded-win text-text-primary"
                >
                  <option value={GATEWAY_ID}>{t("network.nodeDetails.defaultParent")}</option>
                  {eligibleParents(nodesData, selectedData.id)
                    .filter((n) => n.id !== GATEWAY_ID)
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label}
                      </option>
                    ))}
                </select>
              </div>
            )
          )}

          {selectedData.serverId && (
            <button
              onClick={() => navigate("/servers", { state: { editServerId: selectedData.serverId } })}
              className="w-full mt-1 px-2.5 py-1.5 rounded-win bg-accent-primary text-white hover:bg-accent-secondary"
            >
              {t("network.openServer")}
            </button>
          )}
          {!selectedData.serverId && !selectedData.virtual && originalDevice && onAddServer && (
            <button
              onClick={() => onAddServer(originalDevice)}
              className="w-full mt-1 px-2.5 py-1.5 rounded-win border border-border-primary text-text-secondary hover:text-accent-primary hover:border-accent-primary/40"
            >
              {t("network.addAsServer")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

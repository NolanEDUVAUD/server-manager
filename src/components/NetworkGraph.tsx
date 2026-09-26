import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useT } from "../i18n";
import { NetworkDevice, Server } from "../types";
import { LayoutEdge, LayoutNode, circularLayout, stepForceLayout } from "../utils/forceLayout";

type NodeKind = "gateway" | "server" | "device";
type NodeStatus = "online" | "offline" | "unknown";

interface GraphNodeData {
  id: string;
  label: string;
  kind: NodeKind;
  status: NodeStatus;
  ip?: string;
  mac?: string | null;
  jumpVia?: string | null;
}

const STATUS_COLOR: Record<NodeStatus, string> = {
  online: "#4ade80",
  offline: "#f87171",
  unknown: "#94a3b8",
};

const GATEWAY_ID = "__gateway__";

/** Construit les nœuds et arêtes du graphe à partir des serveurs connus et des appareils détectés. */
function buildGraph(
  servers: Server[],
  statuses: Record<string, { online: boolean }>,
  devices: NetworkDevice[] | null
): { nodesData: Map<string, GraphNodeData>; edges: LayoutEdge[] } {
  const nodesData = new Map<string, GraphNodeData>();
  const edges: LayoutEdge[] = [];

  nodesData.set(GATEWAY_ID, { id: GATEWAY_ID, label: "gateway", kind: "gateway", status: "online" });

  for (const s of servers) {
    const st = statuses[s.id];
    nodesData.set(s.id, {
      id: s.id,
      label: s.name,
      kind: "server",
      status: st ? (st.online ? "online" : "offline") : "unknown",
      ip: s.ip,
      mac: s.mac_address || null,
      jumpVia: s.jump_host_id ? servers.find((j) => j.id === s.jump_host_id)?.name ?? null : null,
    });
    // Un serveur avec un hôte de rebond passe par lui plutôt que directement par la passerelle
    if (s.jump_host_id && servers.some((j) => j.id === s.jump_host_id)) {
      edges.push({ source: s.id, target: s.jump_host_id });
    } else {
      edges.push({ source: s.id, target: GATEWAY_ID });
    }
  }

  const knownIps = new Set(servers.map((s) => s.ip));
  for (const d of devices ?? []) {
    if (knownIps.has(d.ip)) continue; // déjà représenté par le nœud serveur
    const id = `device:${d.ip}`;
    nodesData.set(id, {
      id,
      label: d.known_server ?? d.ip,
      kind: "device",
      // Un appareil listé par le scan a répondu : il est donc en ligne
      status: "online",
      ip: d.ip,
      mac: d.mac,
    });
    edges.push({ source: id, target: GATEWAY_ID });
  }

  return { nodesData, edges };
}

export function NetworkGraph({ servers, statuses, devices }: {
  servers: Server[];
  statuses: Record<string, { online: boolean }>;
  devices: NetworkDevice[] | null;
}) {
  const { t } = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 480 });
  const [, forceRerender] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });

  const { nodesData, edges } = useMemo(() => buildGraph(servers, statuses, devices), [servers, statuses, devices]);

  // Les positions vivent dans une ref (mutées à chaque frame par la simulation) :
  // on ne veut pas re-render 60x/s via setState, juste peindre le SVG.
  const nodesRef = useRef<LayoutNode[]>([]);
  const draggingRef = useRef<{ id: string } | null>(null);
  const panningRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

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

  // Réinitialise les positions quand l'ensemble de nœuds change (id ajouté/retiré)
  useEffect(() => {
    const ids = [...nodesData.keys()];
    const existing = new Map(nodesRef.current.map((n) => [n.id, n]));
    nodesRef.current = ids.map((id) => existing.get(id) ?? circularLayout([id], size.width, size.height, 40)[0]);
    if (!ids.includes(GATEWAY_ID)) return;
    const gateway = nodesRef.current.find((n) => n.id === GATEWAY_ID);
    if (gateway) {
      gateway.x = size.width / 2;
      gateway.y = size.height / 2;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesData]);

  // Boucle d'animation : fait avancer la simulation et repeint
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const gateway = nodesRef.current.find((n) => n.id === GATEWAY_ID);
      if (gateway) gateway.fixed = draggingRef.current?.id !== GATEWAY_ID;
      for (const n of nodesRef.current) {
        if (n.id !== GATEWAY_ID) n.fixed = draggingRef.current?.id === n.id;
      }
      stepForceLayout(nodesRef.current, edges, { width: size.width, height: size.height });
      forceRerender((x) => (x + 1) % 1000000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [edges, size.width, size.height]);

  const toGraphPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    };
  };

  const onBackgroundMouseDown = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    panningRef.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    setSelected(null);
  };

  const onNodeMouseDown = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    draggingRef.current = { id };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (draggingRef.current) {
      const p = toGraphPoint(e.clientX, e.clientY);
      const n = nodesRef.current.find((x) => x.id === draggingRef.current!.id);
      if (n) {
        n.x = p.x;
        n.y = p.y;
      }
    } else if (panningRef.current) {
      const dx = e.clientX - panningRef.current.x;
      const dy = e.clientY - panningRef.current.y;
      setView((v) => ({ ...v, tx: panningRef.current!.tx + dx, ty: panningRef.current!.ty + dy }));
    }
  };

  const endInteraction = () => {
    draggingRef.current = null;
    panningRef.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setView((v) => ({ ...v, scale: Math.min(2.5, Math.max(0.35, v.scale * factor)) }));
  };

  const selectedData = selected ? nodesData.get(selected) : null;
  const selectedPos = selected ? nodesRef.current.find((n) => n.id === selected) : null;

  return (
    <div className="relative bg-bg-tertiary border border-border-primary rounded-win overflow-hidden" style={{ height: 480 }}>
      <svg
        ref={svgRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={onBackgroundMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endInteraction}
        onMouseLeave={endInteraction}
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
            const radius = data.kind === "gateway" ? 14 : 9;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x} ${n.y})`}
                onMouseDown={onNodeMouseDown(n.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(n.id);
                }}
                className="cursor-pointer"
              >
                <title>{data.label}</title>
                <circle
                  r={radius}
                  fill={STATUS_COLOR[data.status]}
                  stroke={selected === n.id ? "var(--accent-primary)" : "var(--bg-primary)"}
                  strokeWidth={selected === n.id ? 3 : 2}
                />
                <text y={radius + 12} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
                  {data.kind === "gateway" ? t("network.gateway") : data.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      <p className="absolute bottom-2 left-2 text-[11px] text-text-muted bg-bg-primary/70 px-2 py-1 rounded pointer-events-none">
        {t("network.graphHint")}
      </p>

      {selectedData && selectedPos && (
        <div className="absolute top-2 right-2 w-56 bg-bg-secondary border border-border-primary rounded-win shadow-win-hover p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-text-primary font-medium truncate">{selectedData.label}</p>
            <button onClick={() => setSelected(null)} className="text-text-muted hover:text-text-primary" aria-label={t("network.closeDetails")}>
              <X size={13} />
            </button>
          </div>
          <p className="text-text-secondary">
            {t("network.nodeDetails.type")}:{" "}
            <span className="text-text-primary">
              {selectedData.kind === "gateway" ? t("network.nodeGateway") : selectedData.kind === "server" ? t("network.nodeServer") : t("network.nodeDevice")}
            </span>
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
          {selectedData.jumpVia && (
            <p className="text-text-secondary">{t("network.nodeDetails.jumpVia")}: <span className="text-text-primary">{selectedData.jumpVia}</span></p>
          )}
        </div>
      )}
    </div>
  );
}

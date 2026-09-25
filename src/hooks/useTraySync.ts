import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../stores/useStore";

/**
 * Met à jour l'icône de zone de notification (infobulle « X/Y en ligne » et menu
 * des groupes) quand le nombre de serveurs en ligne ou la liste des groupes change.
 */
export function useTraySync() {
  const online = useStore((s) => s.servers.filter((sv) => s.statuses[sv.id]?.online).length);
  const total = useStore((s) => s.servers.length);
  const groupsKey = useStore((s) => s.groups.map((g) => `${g.id}:${g.name}`).join("|"));

  useEffect(() => {
    invoke("update_tray_status", { online, total }).catch(() => {});
  }, [online, total, groupsKey]);
}

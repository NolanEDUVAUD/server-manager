/** Dictionnaire anglais : même structure que `fr/` (vérifiée par le type `Dict`) */
import type { Dict } from "..";
import { backup } from "./backup";
import { backups } from "./backups";
import { batch } from "./batch";
import { common } from "./common";
import { consolePage } from "./console";
import { docker } from "./docker";
import { logs } from "./logs";
import { proxmox } from "./proxmox";
import { scheduler } from "./scheduler";
import { settings } from "./settings";
import { updates } from "./updates";
import { webTabs } from "./webTabs";

export const en: Dict = {
  backup,
  backups,
  batch,
  common,
  console: consolePage,
  docker,
  logs,
  proxmox,
  scheduler,
  settings,
  updates,
  webTabs,
};

/**
 * Dictionnaire de référence (français). Chaque espace de noms vit dans son propre
 * fichier ; `en/` doit en reprendre exactement la structure (vérifié par tsc et par
 * i18n.test.ts). Ne jamais nommer une clé « other » : c'est la forme plurielle.
 */
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

export const fr = {
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

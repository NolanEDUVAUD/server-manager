/**
 * Dictionnaire de référence (français). Chaque espace de noms vit dans son propre
 * fichier ; `en/` doit en reprendre exactement la structure (vérifié par tsc et par
 * i18n.test.ts). Ne jamais nommer une clé « other » : c'est la forme plurielle.
 */
import { alerts } from "./alerts";
import { backup } from "./backup";
import { backups } from "./backups";
import { batch } from "./batch";
import { catalog } from "./catalog";
import { common } from "./common";
import { consolePage } from "./console";
import { docker } from "./docker";
import { events } from "./events";
import { filters } from "./filters";
import { groups } from "./groups";
import { iconPicker } from "./iconPicker";
import { labPower } from "./labPower";
import { logs } from "./logs";
import { network } from "./network";
import { orgFields } from "./orgFields";
import { probes } from "./probes";
import { proxmox } from "./proxmox";
import { resources } from "./resources";
import { scheduler } from "./scheduler";
import { services } from "./services";
import { settings } from "./settings";
import { updates } from "./updates";
import { webTabs } from "./webTabs";

export const fr = {
  alerts,
  backup,
  backups,
  batch,
  catalog,
  common,
  console: consolePage,
  docker,
  events,
  filters,
  groups,
  iconPicker,
  labPower,
  logs,
  network,
  orgFields,
  probes,
  proxmox,
  resources,
  scheduler,
  services,
  settings,
  updates,
  webTabs,
};

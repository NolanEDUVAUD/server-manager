/** Dictionnaire anglais : même structure que `fr/` (vérifiée par le type `Dict`) */
import type { Dict } from "..";
import { alerts } from "./alerts";
import { appUpdate } from "./appUpdate";
import { backup } from "./backup";
import { backups } from "./backups";
import { batch } from "./batch";
import { bugReport } from "./bugReport";
import { catalog } from "./catalog";
import { common } from "./common";
import { consolePage } from "./console";
import { dashboard } from "./dashboard";
import { docker } from "./docker";
import { events } from "./events";
import { filters } from "./filters";
import { format } from "./format";
import { groups } from "./groups";
import { iconPicker } from "./iconPicker";
import { integrations } from "./integrations";
import { labPower } from "./labPower";
import { layout } from "./layout";
import { lock } from "./lock";
import { logs } from "./logs";
import { modules } from "./modules";
import { network } from "./network";
import { onboarding } from "./onboarding";
import { orgFields } from "./orgFields";
import { organisation } from "./organisation";
import { palette } from "./palette";
import { probes } from "./probes";
import { proxmox } from "./proxmox";
import { resources } from "./resources";
import { retention } from "./retention";
import { scheduler } from "./scheduler";
import { serverForm } from "./serverForm";
import { servers } from "./servers";
import { services } from "./services";
import { settings } from "./settings";
import { settingsPage } from "./settingsPage";
import { shortcuts } from "./shortcuts";
import { sshAuth } from "./sshAuth";
import { sshKeys } from "./sshKeys";
import { support } from "./support";
import { themes } from "./themes";
import { updates } from "./updates";
import { webTabs } from "./webTabs";

export const en: Dict = {
  alerts,
  appUpdate,
  backup,
  backups,
  batch,
  bugReport,
  catalog,
  common,
  console: consolePage,
  dashboard,
  docker,
  events,
  filters,
  format,
  groups,
  iconPicker,
  integrations,
  labPower,
  layout,
  lock,
  logs,
  modules,
  network,
  onboarding,
  orgFields,
  organisation,
  palette,
  probes,
  proxmox,
  resources,
  retention,
  scheduler,
  serverForm,
  servers,
  services,
  settings,
  settingsPage,
  shortcuts,
  sshAuth,
  sshKeys,
  support,
  themes,
  updates,
  webTabs,
};

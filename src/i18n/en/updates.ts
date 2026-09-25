import type { Dict } from "..";

export const updates: Dict["updates"] = {
  title: "Updates",
  subtitle: "Pending packages, required reboots, containers on an outdated image — read-only",
  scan: "Scan",
  kernelMismatch: "Different kernels across Proxmox nodes: {list}",
  intro: "Start a scan (read-only: reads the apt cache and Docker state of each server).",
  packages: { one: "{count} package", other: "{count} packages" },
  security: "{count} security",
  rebootRequired: "reboot required",
  listsAge: "apt lists {days} d old",
  showPackages: "Show packages",
  staleContainers: {
    one: "{count} container on an outdated image",
    other: "{count} containers on an outdated image",
  },
  staleHelpBefore: "The newer image is already downloaded: just recreate the container (",
  staleHelpAfter: "in the project folder).",
  prepare: "Prepare the update of {name}",
};

import { describe, it, expect } from "vitest";
import { kernelMismatch } from "./Updates";
import { ServerUpdates } from "../types";

const r = (name: string, kernel: string): ServerUpdates => ({
  server_id: name, name, error: null,
  report: { apt_available: true, packages: [], security_count: 0, reboot_required: false, kernel, lists_age_days: 0, stale_containers: [] },
});

describe("kernelMismatch", () => {
  it("signale des noyaux Proxmox différents (cas réel : Workstation 21 en retard)", () => {
    const res = kernelMismatch([r("minipc", "7.0.14-19-pve"), r("Workstation 21", "7.0.6-2-pve"), r("DockerHost", "6.12.107+deb13-amd64")]);
    expect(res).toBe("minipc 7.0.14-19-pve · Workstation 21 7.0.6-2-pve");
  });

  it("rien si tous les nœuds sont alignés", () => {
    expect(kernelMismatch([r("a", "7.0.14-19-pve"), r("b", "7.0.14-19-pve")])).toBeNull();
  });
});

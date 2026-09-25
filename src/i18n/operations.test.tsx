/** Lot « opérations » (Proxmox, planificateur, tâches en lot) : textes en anglais */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { setLanguage, t } from ".";
import { VmCard } from "../components/VmCard";
import { ScheduleForm } from "../components/ScheduleForm";
import { formatDays, formatSchedule } from "../utils/schedule";
import { detectPrompt, TEMPLATES } from "../utils/batch";
import { ProxmoxVm, Server } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const vm: ProxmoxVm = {
  vmid: 100, name: "web01", node: "pve1", vm_type: "qemu", status: "running",
  cpu: 0.12, mem: 536870912, maxmem: 1073741824, disk: 0, maxdisk: 8589934592,
};

const minipc: Server = {
  id: "s1", name: "minipc", ip: "192.168.1.10", mac_address: "", ssh_user: "root", ssh_password: "",
  ssh_port: 22, shutdown_command: "", reboot_command: "", os_type: "Linux",
};

describe("lot opérations en anglais", () => {
  // Démonter avant de revenir au français : sinon le changement de langue re-rend hors act()
  afterEach(() => {
    cleanup();
    setLanguage("fr");
  });

  it("carte de VM Proxmox", () => {
    setLanguage("en");
    render(<VmCard vm={vm} connectionId="conn-1" onMessage={vi.fn()} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Disk")).toBeInTheDocument();
    expect(screen.getByTitle("Stop")).toBeInTheDocument();
    expect(screen.getByTitle("Migrate to another node")).toBeInTheDocument();
  });

  it("descriptions de planification, jours de la semaine compris", () => {
    expect(formatSchedule([0, 1, 2, 3, 4, 5, 6], "07:00")).toBe("Tous les jours à 07:00");
    expect(formatSchedule([0, 2, 4], "07:00")).toBe("Lun, Mer, Ven à 07:00");

    setLanguage("en");
    expect(formatSchedule([0, 1, 2, 3, 4, 5, 6], "07:00")).toBe("Every day at 07:00");
    expect(formatSchedule([0, 1, 2, 3, 4], "23:00")).toBe("Weekdays at 23:00");
    expect(formatSchedule([5, 6], "09:30")).toBe("Weekends at 09:30");
    expect(formatDays([6, 0, 2, 4])).toBe("Mon, Wed, Fri, Sun");
    expect(formatDays([1, 3, 5])).toBe("Tue, Thu, Sat");
  });

  it("formulaire de tâche planifiée", () => {
    setLanguage("en");
    render(<ScheduleForm servers={[minipc]} groups={[]} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("New scheduled task")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Shut down" })).toBeInTheDocument();
    expect(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].every((d) => screen.getByRole("button", { name: d }))).toBe(true);

    // Validation : nom requis
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("The name is required")).toBeInTheDocument();
  });

  it("réponses rapides et modèles des tâches en lot", () => {
    setLanguage("en");
    expect(detectPrompt("Do you want to continue? [Y/n] ")!.choices.map((c) => c.label)).toEqual(["Yes", "No"]);
    const dpkg = detectPrompt("Configuration file '/etc/demo.conf'\n*** demo.conf (Y/I/N/O/D/Z) [default=N] ? ")!;
    expect(dpkg.question).toBe("Configuration file modified: /etc/demo.conf");
    expect(dpkg.choices[0].label).toBe("Keep my version");
    expect(TEMPLATES.map((tpl) => t(tpl.nameKey))).toContain("Prune unused Docker images");
  });
});

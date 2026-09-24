import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VmCard } from "./VmCard";
import { useStore } from "../stores/useStore";
import { ProxmoxVm } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const runningVm: ProxmoxVm = {
  vmid: 100,
  name: "web01",
  node: "pve1",
  vm_type: "qemu",
  status: "running",
  cpu: 0.12,
  mem: 536870912,
  maxmem: 1073741824,
  disk: 0,
  maxdisk: 8589934592,
};

describe("VmCard", () => {
  it("affiche le nom, le statut et le nœud de la VM", () => {
    render(<VmCard vm={runningVm} connectionId="conn-1" onMessage={vi.fn()} />);
    expect(screen.getByText("web01")).toBeInTheDocument();
    expect(screen.getByText(/pve1/)).toBeInTheDocument();
    expect(screen.getByText(/En cours/)).toBeInTheDocument();
  });

  it("distingue deux VMs partageant le même vmid mais un vm_type différent", () => {
    const lxcSameId: ProxmoxVm = { ...runningVm, vm_type: "lxc", name: "ct-same-id", node: "pve2" };
    render(
      <>
        <VmCard vm={runningVm} connectionId="conn-1" onMessage={vi.fn()} />
        <VmCard vm={lxcSameId} connectionId="conn-1" onMessage={vi.fn()} />
      </>
    );
    expect(screen.getByText("web01")).toBeInTheDocument();
    expect(screen.getByText("ct-same-id")).toBeInTheDocument();
  });

  it("désactive le bouton Stop pendant qu'une action est en cours (pas de double appel)", async () => {
    const proxmoxVmAction = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve("UPID:x"), 50)));
    useStore.setState({ proxmoxVmAction });

    render(<VmCard vm={runningVm} connectionId="conn-1" onMessage={vi.fn()} />);
    const stopButton = screen.getByTitle("Arrêter");

    fireEvent.click(stopButton);
    fireEvent.click(stopButton);

    await waitFor(() => expect(proxmoxVmAction).toHaveBeenCalledTimes(1));
  });
});

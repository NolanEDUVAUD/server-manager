import { describe, it, expect } from "vitest";
import { missingMacFixes } from "./network";
import { Server } from "../types";

const srv = (name: string, ip: string, mac = "") => ({ id: name, name, ip, mac_address: mac } as Server);

describe("missingMacFixes", () => {
  it("propose la MAC des serveurs qui n'en ont pas, sauf les cartes virtuelles", () => {
    const servers = [srv("minipc", "192.168.50.53"), srv("DockerHost", "192.168.50.54"), srv("workstation", "192.168.50.56", "02:00:00:00:00:03")];
    const devices = [
      { ip: "192.168.50.53", mac: "02:00:00:00:00:01", virtual_nic: null, known_server: "minipc" },
      { ip: "192.168.50.54", mac: "BC:24:11:00:00:02", virtual_nic: "VM Proxmox", known_server: "DockerHost" },
      { ip: "192.168.50.56", mac: "02:00:00:00:00:03", virtual_nic: null, known_server: "workstation" },
    ];
    expect(missingMacFixes(servers, devices).map((f) => [f.server.name, f.mac])).toEqual([["minipc", "02:00:00:00:00:01"]]);
  });

  it("ignore un serveur absent du scan", () => {
    expect(missingMacFixes([srv("nas", "192.168.50.50")], [])).toEqual([]);
  });
});

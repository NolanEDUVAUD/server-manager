import { describe, it, expect } from "vitest";
import { suggestProbes, describeProbe } from "./probes";
import { Server } from "../types";

const srv = (id: string, os_type: Server["os_type"], ip: string) => ({ id, name: id, os_type, ip } as Server);

describe("sondes", () => {
  it("propose interface + certificat pour Proxmox, interface pour TrueNAS", () => {
    const s = suggestProbes([srv("pve", "Proxmox", "10.0.0.2"), srv("nas", "TrueNAS", "10.0.0.5"), srv("deb", "Linux", "10.0.0.9")], []);
    expect(s.map((p) => p.kind.type)).toEqual(["Http", "TlsExpiry", "Http"]);
    expect(s[0].server_id).toBe("pve");
  });

  it("ne propose pas une sonde déjà existante", () => {
    const first = suggestProbes([srv("pve", "Proxmox", "10.0.0.2")], []);
    expect(suggestProbes([srv("pve", "Proxmox", "10.0.0.2")], [first[0]])).toHaveLength(1);
  });

  it("décrit les sondes", () => {
    expect(describeProbe({ type: "Tcp", host: "h", port: 22 })).toBe("TCP h:22");
    expect(describeProbe({ type: "Http", url: "http://x/ready", expect_status: 200, keyword: "ready" })).toBe("http://x/ready → 200 · « ready »");
  });
});

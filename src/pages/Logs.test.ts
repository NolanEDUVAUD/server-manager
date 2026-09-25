import { describe, it, expect } from "vitest";
import { matchServer } from "./Logs";

describe("matchServer", () => {
  const servers = [{ name: "DockerHost" }, { name: "minipc" }, { name: "Workstation 21(.55)" }];
  it("rapproche un hôte Loki d'un serveur de l'app", () => {
    expect(matchServer("docker-host", servers)?.name).toBe("DockerHost");
    expect(matchServer("minipc", servers)?.name).toBe("minipc");
  });
  it("ne devine pas quand les noms diffèrent", () => {
    expect(matchServer("workstation1", servers)).toBeUndefined();
  });
});

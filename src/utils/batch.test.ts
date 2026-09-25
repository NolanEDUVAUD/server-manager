import { describe, it, expect } from "vitest";
import { looksModifying, TEMPLATES } from "./batch";

describe("looksModifying", () => {
  it("repère les commandes qui modifient le système", () => {
    for (const s of [
      "apt-get -y full-upgrade", "apt install htop", "rm -rf /tmp/x", "sudo reboot", "systemctl restart nginx",
      "docker compose pull", "qm stop 100", "zfs destroy tank/x", "sed -i 's/a/b/' f", "echo x > /etc/hosts",
    ]) {
      expect(looksModifying(s), s).toBe(true);
    }
  });

  it("laisse passer les commandes de lecture", () => {
    for (const s of ["df -h", "apt list --upgradable", "systemctl --failed", "docker ps", "qm list", "zpool status", "uptime"]) {
      expect(looksModifying(s), s).toBe(false);
    }
  });

  it("classe correctement les modèles fournis", () => {
    const modifying = TEMPLATES.filter((t) => looksModifying(t.script)).map((t) => t.name);
    expect(modifying).toEqual(["Mettre à jour les paquets (Debian/Proxmox)", "Nettoyer les images Docker inutilisées"]);
  });
});

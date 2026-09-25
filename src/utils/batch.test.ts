import { describe, it, expect } from "vitest";
import { detectPrompt, looksModifying, TEMPLATES } from "./batch";

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

describe("detectPrompt", () => {
  it("reconnaît la question de dpkg sur un fichier de configuration", () => {
    const out = "Setting up wazuh-agent (4.14.8-1) ...\n\nConfiguration file '/etc/systemd/system/wazuh-agent.service'\n ==> Deleted (by you or by a script) since installation.\n The default action is to keep your current version.\n*** wazuh-agent.service (Y/I/N/O/D/Z) [default=N] ? ";
    const p = detectPrompt(out)!;
    expect(p.question).toContain("/etc/systemd/system/wazuh-agent.service");
    expect(p.choices.map((c) => c.send)).toEqual(["N\n", "Y\n", "D\n"]);
  });

  it("reconnaît les questions oui/non d'apt (anglais et français)", () => {
    expect(detectPrompt("Do you want to continue? [Y/n] ")!.choices.map((c) => c.send)).toEqual(["y\n", "n\n"]);
    expect(detectPrompt("Souhaitez-vous continuer ? [O/n] ")!.choices[0].send).toBe("o\n");
    expect(detectPrompt("Are you sure you want to continue connecting (yes/no/[fingerprint])? ")!.choices[0].send).toBe("yes\n");
  });

  it("ignore une question à laquelle la commande a déjà répondu", () => {
    expect(detectPrompt("Do you want to continue? [Y/n] y\nReading package lists...\n")).toBeNull();
    expect(detectPrompt("")).toBeNull();
  });

  it("signale une question générique sans réponse rapide", () => {
    expect(detectPrompt("Enter passphrase: ")).toEqual({ question: "Enter passphrase:", choices: [] });
  });
});

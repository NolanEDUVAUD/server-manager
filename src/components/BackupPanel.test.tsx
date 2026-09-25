import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { BackupPanel, passphraseIssue } from "./BackupPanel";
import { useStore } from "../stores/useStore";
import { BackupConfigView, BackupSummary } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn().mockResolvedValue("/mnt/nas/sauvegardes") }));

const PASS = "une phrase de passe solide";
const autoOff: BackupConfigView = { enabled: false, folder: "", frequency: "Daily", keep: 7, last_run: null, last_error: null, has_passphrase: false };
const summary: BackupSummary = {
  app_version: "0.3.0", created_at: "2026-09-25T10:00:00Z", servers: 4, groups: 2, probes: 6, proxmox_connections: 1, integrations: 2, schedules: 3,
};

/** Réponses du backend par commande */
function backend(overrides: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = { get_backup_settings: autoOff, ...overrides };
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    const a = answers[cmd];
    if (a instanceof Error) throw a.message;
    return a;
  });
}

describe("passphraseIssue", () => {
  it("impose 12 caractères et une confirmation identique", () => {
    expect(passphraseIssue("court")).toBe("short");
    expect(passphraseIssue("ééééééééééé")).toBe("short");
    expect(passphraseIssue(PASS)).toBeNull();
    expect(passphraseIssue(PASS, PASS + "!")).toBe("mismatch");
    expect(passphraseIssue(PASS, PASS)).toBeNull();
  });
});

describe("BackupPanel", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("n'exporte qu'avec une phrase de passe valide et confirmée", async () => {
    backend({ backup_export: "/tmp/spm.spmbackup" });
    render(<BackupPanel />);
    const exportButton = screen.getByRole("button", { name: /Exporter une sauvegarde chiffrée/ });
    expect(exportButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Phrase de passe", { selector: "#backup-pass" }), { target: { value: PASS } });
    fireEvent.change(screen.getByLabelText("Confirmer la phrase de passe"), { target: { value: "autre chose encore" } });
    expect(screen.getByText("Les deux phrases de passe sont différentes")).toBeInTheDocument();
    expect(exportButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Confirmer la phrase de passe"), { target: { value: PASS } });
    await act(async () => { fireEvent.click(exportButton); });
    expect(invoke).toHaveBeenCalledWith("backup_export", { passphrase: PASS });
    expect(await screen.findByText(/Sauvegarde enregistrée : \/tmp\/spm.spmbackup/)).toBeInTheDocument();
  });

  it("restaure seulement après l'aperçu et une confirmation explicite", async () => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ initialize });
    backend({ backup_inspect: summary, backup_apply: undefined });
    render(<BackupPanel />);

    fireEvent.change(screen.getByLabelText("Phrase de passe", { selector: "#restore-pass" }), { target: { value: PASS } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Choisir une sauvegarde/ })); });
    expect(invoke).toHaveBeenCalledWith("backup_inspect", { passphrase: PASS });
    expect(await screen.findByText(/4 serveur\(s\), 2 groupe\(s\), 6 service\(s\)/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("backup_apply");

    fireEvent.click(screen.getByRole("button", { name: "Restaurer" }));
    expect(screen.getByText(/sera remplacée par celle de la sauvegarde/)).toBeInTheDocument();
    const restoreButtons = screen.getAllByRole("button", { name: "Restaurer" });
    await act(async () => { fireEvent.click(restoreButtons[restoreButtons.length - 1]); });
    expect(invoke).toHaveBeenCalledWith("backup_apply");
    await waitFor(() => expect(initialize).toHaveBeenCalled());
    expect(await screen.findByText("Configuration restaurée")).toBeInTheDocument();
  });

  it("affiche une erreur lisible si la phrase de passe est fausse", async () => {
    backend({ backup_inspect: new Error("Phrase de passe incorrecte ou fichier altéré") });
    render(<BackupPanel />);
    fireEvent.change(screen.getByLabelText("Phrase de passe", { selector: "#restore-pass" }), { target: { value: "mauvaise phrase" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Choisir une sauvegarde/ })); });
    expect(await screen.findByText("Phrase de passe incorrecte ou fichier altéré")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restaurer" })).toBeNull();
  });

  it("active la sauvegarde automatique avec dossier et phrase de passe", async () => {
    const saved: BackupConfigView = { ...autoOff, enabled: true, folder: "/mnt/nas/sauvegardes", has_passphrase: true };
    backend({ save_backup_settings: saved });
    render(<BackupPanel />);
    fireEvent.click(await screen.findByLabelText(/Activer la sauvegarde automatique/));
    fireEvent.click(screen.getByRole("button", { name: "Parcourir…" }));
    await waitFor(() => expect(screen.getByLabelText("Dossier de destination")).toHaveValue("/mnt/nas/sauvegardes"));

    // Phrase requise tant qu'aucune n'est enregistrée
    const save = screen.getByRole("button", { name: "Enregistrer" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Phrase de passe", { selector: "#backup-auto-pass" }), { target: { value: PASS } });
    await act(async () => { fireEvent.click(save); });
    expect(invoke).toHaveBeenCalledWith("save_backup_settings", {
      config: { enabled: true, folder: "/mnt/nas/sauvegardes", frequency: "Daily", keep: 7, last_run: null, last_error: null },
      passphrase: PASS,
    });
    // Enregistrée : le champ est vidé et la sauvegarde immédiate devient possible
    expect(await screen.findByRole("button", { name: /Sauvegarder maintenant/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Phrase de passe", { selector: "#backup-auto-pass" })).toHaveValue("");
  });

  it("montre le dernier échec de la sauvegarde automatique", async () => {
    backend({ get_backup_settings: { ...autoOff, enabled: true, folder: "/x", has_passphrase: true, last_error: "Le dossier de destination n'existe pas" } });
    render(<BackupPanel />);
    expect(await screen.findByText(/Dernier échec : Le dossier de destination n'existe pas/)).toBeInTheDocument();
  });
});

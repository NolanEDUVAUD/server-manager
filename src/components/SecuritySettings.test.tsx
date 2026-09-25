import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { SecuritySettings } from "./SecuritySettings";
import { useLockStore } from "../stores/useLockStore";
import { LockStatus } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

const disabled: LockStatus = {
  enabled: false,
  locked: false,
  method: "None",
  has_pin: false,
  master_password: false,
  idle_minutes: 0,
  lock_on_session_lock: false,
  hello_available: false,
  session_detection: true,
  retry_after_ms: 0,
};

function backend(status: LockStatus) {
  mockedInvoke.mockImplementation(async (cmd: string) => (cmd === "lock_status" ? status : { ...status, enabled: true }));
}

describe("SecuritySettings", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    useLockStore.setState({ status: null, error: null });
  });

  it("explique ce qui est suspendu pendant le verrouillage", async () => {
    backend(disabled);
    render(<SecuritySettings />);
    expect(await screen.findByText(/le ping continue/)).toBeInTheDocument();
    // Hello indisponible : option grisée
    expect(screen.getByRole("radio", { name: /Windows Hello/ })).toBeDisabled();
  });

  it("activer le PIN : validation locale puis enregistrement sans secret actuel", async () => {
    backend(disabled);
    render(<SecuritySettings />);
    fireEvent.click(await screen.findByRole("radio", { name: /^PIN/ }));
    fireEvent.change(screen.getByLabelText("Nouveau PIN"), { target: { value: "4821" } });
    fireEvent.change(screen.getByLabelText("Confirmer le PIN"), { target: { value: "4822" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("correspondent");
    expect(mockedInvoke).not.toHaveBeenCalledWith("lock_configure", expect.anything());

    fireEvent.change(screen.getByLabelText("Confirmer le PIN"), { target: { value: "4821" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await screen.findByText("Verrouillage enregistré");
    expect(mockedInvoke).toHaveBeenCalledWith("lock_configure", {
      config: { method: "Pin", idle_minutes: 15, lock_on_session_lock: true },
      newPin: "4821",
      currentSecret: null,
    });
  });

  it("verrouillage actif : le PIN actuel est demandé", async () => {
    backend({ ...disabled, enabled: true, method: "Pin", has_pin: true, idle_minutes: 5 });
    render(<SecuritySettings />);
    expect(await screen.findAllByLabelText("PIN actuel")).not.toHaveLength(0);
  });

  it("mot de passe maître : confirmation qui prévient de la perte définitive", async () => {
    backend(disabled);
    render(<SecuritySettings />);
    fireEvent.change(await screen.findByLabelText("Mot de passe maître"), { target: { value: "phrase secrète" } });
    fireEvent.change(screen.getByLabelText("Confirmer le mot de passe maître"), { target: { value: "phrase secrète" } });
    fireEvent.click(screen.getByRole("button", { name: /Activer le mot de passe maître/ }));
    expect(screen.getByText(/définitivement\s+irrécupérables/)).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("master_password_enable", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Activer" }));
    await screen.findByText("Mot de passe maître activé");
    expect(mockedInvoke).toHaveBeenCalledWith("master_password_enable", { password: "phrase secrète", currentSecret: null });
  });
});

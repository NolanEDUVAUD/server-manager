import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { LockGate } from "./LockGate";
import { useLockStore } from "../stores/useLockStore";
import { LockStatus } from "../types";

// Gestionnaire de l'événement « lock-state », pour simuler un verrouillage décidé par le backend
let lockEvent: ((e: { payload: LockStatus }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, cb: (e: { payload: LockStatus }) => void) => {
    lockEvent = cb;
    return Promise.resolve(() => {});
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

const base: LockStatus = {
  enabled: true,
  locked: false,
  method: "Pin",
  has_pin: true,
  master_password: false,
  idle_minutes: 10,
  lock_on_session_lock: true,
  hello_available: true,
  session_detection: true,
  retry_after_ms: 0,
};

/** Backend simulé : `lock_status` renvoie `initial`, les autres commandes sont définies par test */
function backend(initial: LockStatus, handlers: Record<string, (args?: unknown) => unknown> = {}) {
  mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd in handlers) return handlers[cmd](args);
    if (cmd === "lock_status") return initial;
    if (cmd === "get_settings") throw new Error("non utilisé");
    return undefined;
  });
}

const SECRET_CONTENT = "Données de minipc (192.168.1.10)";
const renderGate = () =>
  render(
    <LockGate>
      <p>{SECRET_CONTENT}</p>
    </LockGate>
  );

describe("LockGate", () => {
  beforeEach(() => {
    lockEvent = null;
    mockedInvoke.mockReset();
    useLockStore.setState({ status: null, error: null });
  });

  it("affiche l'application quand elle n'est pas verrouillée", async () => {
    backend(base);
    renderGate();
    expect(await screen.findByText(SECRET_CONTENT)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Application verrouillée" })).toBeNull();
  });

  it("ne monte rien tant que l'état du verrouillage est inconnu", () => {
    mockedInvoke.mockImplementation(() => new Promise(() => {}));
    renderGate();
    expect(screen.queryByText(SECRET_CONTENT)).toBeNull();
  });

  it("verrouillée par PIN : contenu masqué, champ PIN seul", async () => {
    backend({ ...base, locked: true });
    renderGate();
    expect(await screen.findByLabelText("PIN")).toBeInTheDocument();
    expect(screen.queryByText(SECRET_CONTENT)).toBeNull();
    expect(screen.queryByText(/Windows Hello/)).toBeNull();
    expect(screen.queryByLabelText("Mot de passe maître")).toBeNull();
  });

  it("mode Windows Hello : bouton Hello et PIN de secours", async () => {
    backend({ ...base, locked: true, method: "Hello" });
    renderGate();
    expect(await screen.findByRole("button", { name: /Déverrouiller avec Windows Hello/ })).toBeInTheDocument();
    expect(screen.getByLabelText("PIN")).toBeInTheDocument();
    expect(screen.queryByText(SECRET_CONTENT)).toBeNull();
  });

  it("mot de passe maître : lui seul, et l'écran dit pourquoi Hello / PIN ne suffisent pas", async () => {
    backend({ ...base, locked: true, method: "Hello", master_password: true });
    renderGate();
    expect(await screen.findByLabelText("Mot de passe maître")).toBeInTheDocument();
    expect(screen.queryByLabelText("PIN")).toBeNull();
    expect(screen.queryByRole("button", { name: /Windows Hello/ })).toBeNull();
    expect(screen.getByText(/Windows Hello et le PIN ne permettent pas de la\s+déchiffrer/)).toBeInTheDocument();
  });

  it("un verrouillage décidé par le backend démonte le contenu", async () => {
    backend(base);
    renderGate();
    expect(await screen.findByText(SECRET_CONTENT)).toBeInTheDocument();
    act(() => lockEvent!({ payload: { ...base, locked: true } }));
    expect(screen.queryByText(SECRET_CONTENT)).toBeNull();
    expect(screen.getByRole("dialog", { name: "Application verrouillée" })).toBeInTheDocument();
  });

  it("PIN incorrect : vérification en cours puis message d'erreur lisible", async () => {
    let reject: (e: string) => void = () => {};
    backend({ ...base, locked: true }, {
      unlock_with_pin: () => new Promise((_, r) => { reject = r; }),
    });
    renderGate();
    const input = await screen.findByLabelText("PIN");
    // Seuls les chiffres sont acceptés
    fireEvent.change(input, { target: { value: "48a21" } });
    expect(input).toHaveValue("4821");
    fireEvent.click(screen.getByRole("button", { name: "Déverrouiller" }));
    expect(await screen.findByText("Vérification…")).toBeInTheDocument();
    expect(mockedInvoke).toHaveBeenCalledWith("unlock_with_pin", { pin: "4821" });
    await act(async () => reject("PIN incorrect"));
    expect(await screen.findByRole("alert")).toHaveTextContent("PIN incorrect");
    expect(screen.queryByText(SECRET_CONTENT)).toBeNull();
  });

  it("déverrouillage réussi : le contenu revient", async () => {
    backend({ ...base, locked: true }, { unlock_with_pin: () => ({ ...base, locked: false }) });
    renderGate();
    fireEvent.change(await screen.findByLabelText("PIN"), { target: { value: "4821" } });
    fireEvent.click(screen.getByRole("button", { name: "Déverrouiller" }));
    expect(await screen.findByText(SECRET_CONTENT)).toBeInTheDocument();
  });

  it("attente imposée : bouton désactivé avec le décompte", async () => {
    backend({ ...base, locked: true, retry_after_ms: 9_000 });
    renderGate();
    fireEvent.change(await screen.findByLabelText("PIN"), { target: { value: "4821" } });
    expect(screen.getByRole("button", { name: "Patiente 9 s" })).toBeDisabled();
  });

  it("Ctrl+Maj+L verrouille ; l'activité est remontée avec limitation", async () => {
    backend(base, { lock_now: () => ({ ...base, locked: true }) });
    renderGate();
    await screen.findByText(SECRET_CONTENT);
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.mouseMove(window);
    fireEvent.keyDown(window, { key: "b" });
    expect(mockedInvoke.mock.calls.filter(([c]) => c === "lock_activity")).toHaveLength(1);
    fireEvent.keyDown(window, { key: "L", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.queryByText(SECRET_CONTENT)).toBeNull());
    expect(mockedInvoke).toHaveBeenCalledWith("lock_now", undefined);
  });

  it("verrouillage non configuré : ni activité remontée ni raccourci", async () => {
    backend({ ...base, enabled: false, method: "None", has_pin: false });
    renderGate();
    await screen.findByText(SECRET_CONTENT);
    fireEvent.keyDown(window, { key: "L", ctrlKey: true, shiftKey: true });
    fireEvent.mouseMove(window);
    const commands = mockedInvoke.mock.calls.map(([c]) => c);
    expect(commands).not.toContain("lock_now");
    expect(commands).not.toContain("lock_activity");
  });
});

import { FormEvent, useEffect, useState } from "react";
import { Loader2, Lock, ScanFace } from "lucide-react";
import { LockStatus } from "../types";
import { useLockStore } from "../stores/useLockStore";
import { formatWait, PIN_MAX, unlockMode } from "../utils/lock";
import { cn } from "../utils";

const inputClass =
  "w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary text-center " +
  "tracking-widest focus:outline-none focus:border-accent-primary transition-colors duration-150";

/**
 * Écran de verrouillage plein écran et opaque. Il est rendu À LA PLACE de
 * l'application (LockGate) : aucune donnée n'est montée derrière lui.
 */
export function LockScreen({ status }: { status: LockStatus }) {
  const mode = unlockMode(status);
  const { unlockWithPin, unlockWithPassword, unlockWithHello, load } = useLockStore();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<"secret" | "hello" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Attente imposée après plusieurs échecs, décomptée seconde par seconde
  const [wait, setWait] = useState(status.retry_after_ms);

  useEffect(() => setWait(status.retry_after_ms), [status.retry_after_ms]);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => Math.max(0, w - 1000)), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function run(kind: "secret" | "hello", action: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
      // Relit l'état pour afficher l'attente éventuellement imposée
      await load();
    } finally {
      setSecret("");
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!secret || busy || wait > 0) return;
    const value = secret;
    run("secret", () => (mode === "password" ? unlockWithPassword(value) : unlockWithPin(value)));
  }

  const isPassword = mode === "password";
  const label = isPassword ? "Mot de passe maître" : "PIN";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Application verrouillée"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-bg-primary text-text-primary select-none"
    >
      <div className="w-full max-w-sm mx-4 bg-bg-secondary border border-border-primary rounded-win-lg shadow-win-hover p-6 space-y-5 animate-fade-in">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="p-3 rounded-full bg-accent-primary/15">
            <Lock size={22} className="text-accent-primary" />
          </div>
          <h1 className="text-base font-semibold">Server Manager est verrouillé</h1>
          <p className="text-xs text-text-secondary">
            {isPassword
              ? "Saisis le mot de passe maître pour déchiffrer tes secrets."
              : mode === "hello"
                ? "Déverrouille avec Windows Hello, ou avec ton PIN."
                : "Saisis ton PIN pour continuer."}
          </p>
        </div>

        {mode === "hello" && (
          <>
            <button
              type="button"
              onClick={() => run("hello", unlockWithHello)}
              disabled={busy !== null}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-win bg-accent-primary text-white hover:bg-accent-secondary disabled:opacity-60 transition-colors duration-150"
            >
              {busy === "hello" ? <Loader2 size={16} className="animate-spin" /> : <ScanFace size={16} />}
              {busy === "hello" ? "En attente de Windows Hello…" : "Déverrouiller avec Windows Hello"}
            </button>
            <div className="flex items-center gap-3 text-[11px] text-text-muted">
              <span className="flex-1 border-t border-border-primary" />
              ou avec le PIN de secours
              <span className="flex-1 border-t border-border-primary" />
            </div>
          </>
        )}

        <form onSubmit={submit} className="space-y-3" aria-busy={busy === "secret"}>
          <input
            type="password"
            aria-label={label}
            placeholder={label}
            inputMode={isPassword ? undefined : "numeric"}
            autoComplete="off"
            autoFocus
            maxLength={isPassword ? 256 : PIN_MAX}
            value={secret}
            disabled={busy !== null}
            onChange={(e) => setSecret(isPassword ? e.target.value : e.target.value.replace(/\D/g, ""))}
            className={inputClass}
          />
          <button
            type="submit"
            disabled={busy !== null || !secret || wait > 0}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-4 py-2 text-sm rounded-win transition-colors duration-150 disabled:opacity-60",
              mode === "hello" ? "bg-bg-active text-text-primary hover:bg-bg-hover" : "bg-accent-primary text-white hover:bg-accent-secondary"
            )}
          >
            {busy === "secret" && <Loader2 size={14} className="animate-spin" />}
            {busy === "secret" ? "Vérification…" : wait > 0 ? `Patiente ${formatWait(wait)}` : "Déverrouiller"}
          </button>
        </form>

        {error && (
          <p role="alert" className="text-xs text-red-400 text-center break-words">
            {error}
          </p>
        )}

        {isPassword && (
          <p className="text-[11px] text-text-muted text-center leading-relaxed">
            Un mot de passe maître protège la clé des secrets : Windows Hello et le PIN ne permettent pas de la
            déchiffrer, seul ce mot de passe déverrouille l'application.
          </p>
        )}
      </div>
    </div>
  );
}

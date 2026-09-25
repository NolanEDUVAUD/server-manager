import { useEffect, useState } from "react";
import { KeyRound, Loader2, Lock, ShieldCheck } from "lucide-react";
import { LockMethod, LockStatus } from "../types";
import { useLockStore } from "../stores/useLockStore";
import { useToast } from "../hooks/useToast";
import { ConfirmDialog } from "./ConfirmDialog";
import { ToastContainer } from "./Toast";
import {
  formatIdle,
  IDLE_CHOICES,
  masterPasswordError,
  PIN_MAX,
  PIN_MIN,
  pinError,
  SUSPENDED_WHILE_LOCKED_KEY,
} from "../utils/lock";
import { cn } from "../utils";
import { useT } from "../i18n";

const inputClass =
  "w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary " +
  "focus:outline-none focus:border-accent-primary transition-colors duration-150 disabled:opacity-60";
const primaryButton =
  "flex items-center gap-2 px-4 py-2 text-sm rounded-win bg-accent-primary text-white hover:bg-accent-secondary " +
  "transition-colors duration-150 disabled:opacity-60";
const secondaryButton =
  "flex items-center gap-2 px-3 py-2 text-sm rounded-win bg-bg-active text-text-primary hover:bg-bg-hover " +
  "transition-colors duration-150 disabled:opacity-60";

type Notify = { success: (m: string) => void; error: (m: string) => void };

/** Paramètres → Sécurité : verrouillage de l'application et mot de passe maître */
export function SecuritySettings() {
  const { t } = useT();
  const status = useLockStore((s) => s.status);
  const loadError = useLockStore((s) => s.error);
  const load = useLockStore((s) => s.load);
  const { toasts, removeToast, success, error } = useToast();

  useEffect(() => {
    load();
  }, [load]);

  if (!status) {
    return (
      <div className="max-w-lg space-y-3">
        <h2 className="text-text-primary font-medium text-base">{t("lock.settings.title")}</h2>
        {loadError ? (
          <div className="text-sm text-red-400 space-y-2">
            <p>{t("lock.settings.loadError", { message: loadError })}</p>
            <button onClick={() => load()} className={secondaryButton}>{t("common.retry")}</button>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 size={14} className="animate-spin" /> {t("common.loading")}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-lg">
      <LockSection status={status} notify={{ success, error }} />
      <MasterPasswordSection status={status} notify={{ success, error }} />
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}

/** Champ « secret actuel » exigé pour toute modification quand le verrouillage est actif */
function CurrentSecretField({ status, value, onChange }: { status: LockStatus; value: string; onChange: (v: string) => void }) {
  const { t } = useT();
  if (!status.enabled) return null;
  const label = status.master_password ? t("lock.settings.currentMaster") : t("lock.settings.currentPin");
  return (
    <label className="block">
      <span className="text-text-secondary text-xs block mb-1">{t("lock.settings.currentConfirmation", { label })}</span>
      <input
        type="password"
        aria-label={label}
        autoComplete="off"
        inputMode={status.master_password ? undefined : "numeric"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </label>
  );
}

// ── Verrouillage ─────────────────────────────────────────────────────────────

function LockSection({ status, notify }: { status: LockStatus; notify: Notify }) {
  const { t } = useT();
  const { configure, lockNow } = useLockStore();
  const [method, setMethod] = useState<LockMethod>(status.method);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  // Valeurs proposées à la première activation : 15 min et session Windows
  const [idle, setIdle] = useState(status.enabled ? status.idle_minutes : 15);
  const [sessionLock, setSessionLock] = useState(status.enabled ? status.lock_on_session_lock : status.session_detection);
  const [current, setCurrent] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const usesPin = method !== "None";
  const lockActive = usesPin || status.master_password;
  const idleChoices = IDLE_CHOICES.includes(idle) ? IDLE_CHOICES : [...IDLE_CHOICES, idle].sort((a, b) => a - b);

  async function save() {
    setFormError(null);
    // PIN obligatoire à la première activation, facultatif ensuite (vide = inchangé)
    if (usesPin && (pin || !status.has_pin)) {
      const err = pinError(pin, pinConfirm);
      if (err) return setFormError(err);
    }
    setSaving(true);
    try {
      await configure(
        { method, idle_minutes: lockActive ? idle : status.idle_minutes, lock_on_session_lock: sessionLock },
        usesPin && pin ? pin : null,
        status.enabled ? current : null
      );
      setPin("");
      setPinConfirm("");
      setCurrent("");
      notify.success(usesPin ? t("lock.settings.saved") : t("lock.settings.pinDisabled"));
    } catch (e) {
      setFormError(String(e));
      setCurrent("");
    } finally {
      setSaving(false);
    }
  }

  const methods: { id: LockMethod; label: string; hint: string; disabled?: boolean }[] = [
    { id: "None", label: t("lock.settings.methodNone"), hint: t("lock.settings.methodNoneHint") },
    { id: "Pin", label: t("lock.pin"), hint: t("lock.settings.methodPinHint", { min: PIN_MIN, max: PIN_MAX }) },
    {
      id: "Hello",
      label: "Windows Hello",
      hint: status.hello_available ? t("lock.settings.methodHelloHint") : t("lock.settings.helloUnavailable"),
      disabled: !status.hello_available && status.method !== "Hello",
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-text-primary font-medium text-base">{t("lock.settings.sectionTitle")}</h2>
        {status.enabled && (
          <button onClick={() => lockNow().catch((e) => notify.error(String(e)))} className={secondaryButton} title={t("shortcuts.lockCombo")}>
            <Lock size={14} /> {t("lock.settings.lockNow")}
          </button>
        )}
      </div>

      <div className="bg-bg-tertiary rounded-win p-4 card space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-text-secondary text-xs mb-1">{t("lock.settings.method")}</legend>
          {methods.map((m) => (
            <label key={m.id} className={cn("flex items-start gap-3 cursor-pointer", m.disabled && "opacity-50 cursor-not-allowed")}>
              <input
                type="radio"
                name="lock-method"
                value={m.id}
                checked={method === m.id}
                disabled={m.disabled}
                onChange={() => setMethod(m.id)}
                className="mt-1 accent-[var(--accent-primary)]"
              />
              <span>
                <span className="block text-sm text-text-primary">{m.label}</span>
                <span className="block text-xs text-text-muted">{m.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {status.master_password && (
          <p className="text-xs text-yellow-400">
            {t("lock.settings.masterActiveNote")}
          </p>
        )}

        {usesPin && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-text-secondary text-xs block mb-1">{status.has_pin ? t("lock.settings.newPin") : t("lock.pin")}</span>
              <input
                type="password"
                aria-label={t("lock.settings.newPin")}
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={PIN_MAX}
                placeholder={status.has_pin ? t("lock.settings.pinUnchanged") : t("lock.settings.pinDigits", { min: PIN_MIN, max: PIN_MAX })}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="text-text-secondary text-xs block mb-1">{t("lock.settings.confirmPin")}</span>
              <input
                type="password"
                aria-label={t("lock.settings.confirmPin")}
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={PIN_MAX}
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
                className={inputClass}
              />
            </label>
          </div>
        )}

        {lockActive && (
          <>
            <label className="block">
              <span className="text-text-secondary text-xs block mb-1">{t("lock.settings.idleAfter")}</span>
              <select value={idle} onChange={(e) => setIdle(Number(e.target.value))} className={inputClass} aria-label={t("lock.settings.idleLabel")}>
                {idleChoices.map((m) => (
                  <option key={m} value={m}>{formatIdle(m)}</option>
                ))}
              </select>
            </label>
            <label className={cn("flex items-start gap-3", !status.session_detection && "opacity-60")}>
              <input
                type="checkbox"
                checked={sessionLock}
                disabled={!status.session_detection}
                onChange={(e) => setSessionLock(e.target.checked)}
                className="mt-1 accent-[var(--accent-primary)]"
              />
              <span>
                <span className="block text-sm text-text-primary">{t("lock.settings.sessionLock")}</span>
                <span className="block text-xs text-text-muted">
                  {status.session_detection ? t("lock.settings.sessionHelp") : t("lock.settings.sessionUnavailable")}
                </span>
              </span>
            </label>
          </>
        )}

        <CurrentSecretField status={status} value={current} onChange={setCurrent} />

        {formError && <p role="alert" className="text-xs text-red-400 break-words">{formError}</p>}

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving} className={primaryButton}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? t("lock.verifying") : t("lock.settings.save")}
          </button>
        </div>
      </div>
      <p className="text-xs text-text-muted leading-relaxed">{t(SUSPENDED_WHILE_LOCKED_KEY)}</p>
    </section>
  );
}

// ── Mot de passe maître ──────────────────────────────────────────────────────

type PendingAction = "enable" | "change" | "remove" | null;

function MasterPasswordSection({ status, notify }: { status: LockStatus; notify: Notify }) {
  const { t } = useT();
  const { enableMasterPassword, changeMasterPassword, removeMasterPassword } = useLockStore();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [current, setCurrent] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function reset() {
    setPassword("");
    setConfirm("");
    setCurrent("");
  }

  /** Validation avant la demande de confirmation */
  function ask(action: Exclude<PendingAction, null>) {
    setFormError(null);
    if (action !== "remove") {
      const err = masterPasswordError(password, confirm);
      if (err) return setFormError(err);
    }
    if ((action !== "enable" || status.enabled) && !current) {
      return setFormError(status.master_password ? t("lock.master.enterCurrentMaster") : t("lock.master.enterCurrentPin"));
    }
    setPending(action);
  }

  async function run() {
    const action = pending;
    setPending(null);
    setBusy(true);
    try {
      if (action === "enable") await enableMasterPassword(password, status.enabled ? current : null);
      if (action === "change") await changeMasterPassword(current, password);
      if (action === "remove") await removeMasterPassword(current);
      notify.success(
        action === "enable" ? t("lock.master.enabled") : action === "change" ? t("lock.master.changed") : t("lock.master.removed")
      );
      reset();
    } catch (e) {
      setFormError(String(e));
      setCurrent("");
    } finally {
      setBusy(false);
    }
  }

  const confirmTexts: Record<Exclude<PendingAction, null>, { title: string; message: string; label: string }> = {
    enable: {
      title: t("lock.master.confirmEnable.title"),
      label: t("lock.master.confirmEnable.label"),
      message: t("lock.master.confirmEnable.message"),
    },
    change: {
      title: t("lock.master.confirmChange.title"),
      label: t("lock.master.confirmChange.label"),
      message: t("lock.master.confirmChange.message"),
    },
    remove: {
      title: t("lock.master.confirmRemove.title"),
      label: t("lock.master.confirmRemove.label"),
      message: t("lock.master.confirmRemove.message"),
    },
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound size={16} className="text-accent-primary" />
        <h2 className="text-text-primary font-medium text-base">{t("lock.masterPassword")}</h2>
        {status.master_password && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <ShieldCheck size={12} /> {t("lock.master.active")}
          </span>
        )}
      </div>
      <p className="text-xs text-text-secondary leading-relaxed">
        {t("lock.master.intro")}
      </p>

      <div className="bg-bg-tertiary rounded-win p-4 card space-y-3">
        {status.master_password && (
          <CurrentSecretField status={status} value={current} onChange={setCurrent} />
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-text-secondary text-xs block mb-1">
              {status.master_password ? t("lock.master.newPassword") : t("lock.masterPassword")}
            </span>
            <input
              type="password"
              aria-label={status.master_password ? t("lock.master.newMasterLabel") : t("lock.masterPassword")}
              autoComplete="new-password"
              maxLength={256}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="text-text-secondary text-xs block mb-1">{t("lock.master.confirm")}</span>
            <input
              type="password"
              aria-label={t("lock.master.confirmLabel")}
              autoComplete="new-password"
              maxLength={256}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        {!status.master_password && (
          <CurrentSecretField status={status} value={current} onChange={setCurrent} />
        )}

        {formError && <p role="alert" className="text-xs text-red-400 break-words">{formError}</p>}

        <div className="flex flex-wrap items-center gap-2">
          {status.master_password ? (
            <>
              <button onClick={() => ask("change")} disabled={busy} className={primaryButton}>
                {busy && <Loader2 size={14} className="animate-spin" />} {t("lock.master.change")}
              </button>
              <button onClick={() => ask("remove")} disabled={busy} className={cn(secondaryButton, "text-accent-error")}>
                {t("lock.master.remove")}
              </button>
            </>
          ) : (
            <button onClick={() => ask("enable")} disabled={busy} className={primaryButton}>
              {busy && <Loader2 size={14} className="animate-spin" />} {t("lock.master.enable")}
            </button>
          )}
        </div>
      </div>

      {pending && (
        <ConfirmDialog
          title={confirmTexts[pending].title}
          message={confirmTexts[pending].message}
          confirmLabel={confirmTexts[pending].label}
          dangerous
          onConfirm={run}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}

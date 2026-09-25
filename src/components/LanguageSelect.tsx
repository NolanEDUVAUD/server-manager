import { useStore } from "../stores/useStore";
import { useToast } from "../hooks/useToast";
import { LANGUAGES, isLang, useT } from "../i18n";
import { ToastContainer } from "./Toast";

/** Choix de la langue de l'interface (Paramètres → Général), appliqué immédiatement */
export function LanguageSelect() {
  const { settings, updateGeneral } = useStore();
  const { t } = useT();
  const { toasts, removeToast, error } = useToast();

  const change = async (value: string) => {
    if (!isLang(value)) return;
    try {
      await updateGeneral({ language: value });
    } catch (e) {
      error(t("common.errorPrefix", { message: String(e) }));
    }
  };

  return (
    <div className="bg-bg-tertiary rounded-win p-4 card space-y-1.5">
      <label htmlFor="app-language" className="text-text-primary text-sm block">{t("settings.language.label")}</label>
      <select
        id="app-language"
        value={settings.general.language ?? "fr"}
        onChange={(e) => change(e.target.value)}
        className="w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent-primary"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
      <p className="text-text-muted text-xs">{t("settings.language.help")}</p>
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}

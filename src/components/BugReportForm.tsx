import { useState } from "react";
import { Check, Copy, ExternalLink, Send } from "lucide-react";
import { useT } from "../i18n";
import { useStore } from "../stores/useStore";
import { useAppUpdate } from "../stores/useAppUpdate";
import { MODULES } from "../utils/modules";
import { copyToClipboard, openExternal } from "../utils";
import { BugReportInput, buildBugReportIssueUrl, buildBugReportText } from "../utils/bugReport";

/** Plateforme lisible, jamais le nom de la machine (`navigator.platform`, ou `userAgent` en repli) */
function currentPlatform(): string {
  return navigator.platform || navigator.userAgent || "inconnu";
}

/** Paramètres → Signaler un problème : formulaire de rapport de bug pré-rempli sur GitHub */
export function BugReportForm() {
  const { t } = useT();
  const settings = useStore((s) => s.settings);
  const info = useAppUpdate((s) => s.info);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [includeSystemInfo, setIncludeSystemInfo] = useState(true);
  const [titleError, setTitleError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openError, setOpenError] = useState(false);

  const buildInput = (): BugReportInput => ({
    title,
    description,
    stepsToReproduce: steps,
    expected,
    actual,
    systemInfo: includeSystemInfo
      ? {
          appVersion: info?.current_version ?? "?",
          platform: currentPlatform(),
          language: settings.general.language,
          enabledModules: MODULES.filter((m) => !settings.general.hidden_modules.includes(m.key)).map((m) => m.key),
        }
      : null,
  });

  const handleSend = async () => {
    if (!title.trim()) {
      setTitleError(true);
      return;
    }
    setTitleError(false);
    setOpenError(false);
    const ok = await openExternal(buildBugReportIssueUrl(buildInput()));
    if (!ok) setOpenError(true);
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(buildBugReportText(buildInput()));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-text-primary font-medium text-base">{t("bugReport.title")}</h2>
      <p className="text-text-secondary text-sm">{t("bugReport.intro")}</p>

      <div className="bg-bg-tertiary rounded-win p-4 card space-y-4">
        <div className="form-row">
          <label className="text-text-secondary text-xs block mb-1">{t("bugReport.fields.title")}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (e.target.value.trim()) setTitleError(false);
            }}
            placeholder={t("bugReport.fields.titlePlaceholder")}
            className={[
              "w-full bg-bg-input border rounded-win px-3 py-2 text-text-primary text-sm",
              "focus:outline-none focus:border-accent-primary transition-colors duration-150",
              titleError ? "border-red-500" : "border-border-primary",
            ].join(" ")}
          />
          {titleError && <p className="text-red-400 text-xs mt-1">{t("bugReport.titleRequired")}</p>}
        </div>

        <TextAreaRow label={t("bugReport.fields.description")} placeholder={t("bugReport.fields.descriptionPlaceholder")} value={description} onChange={setDescription} />
        <TextAreaRow label={t("bugReport.fields.steps")} placeholder={t("bugReport.fields.stepsPlaceholder")} value={steps} onChange={setSteps} rows={4} />
        <TextAreaRow label={t("bugReport.fields.expected")} value={expected} onChange={setExpected} />
        <TextAreaRow label={t("bugReport.fields.actual")} value={actual} onChange={setActual} />

        <label className="flex items-start gap-2 cursor-pointer pt-1 border-t border-border-secondary">
          <input
            type="checkbox"
            checked={includeSystemInfo}
            onChange={(e) => setIncludeSystemInfo(e.target.checked)}
            className="accent-accent-primary mt-0.5"
          />
          <span>
            <span className="text-text-primary text-sm">{t("bugReport.includeSystemInfo")}</span>
            <span className="block text-text-muted text-xs mt-0.5">{t("bugReport.includeSystemInfoHelp")}</span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={handleSend}
            className="flex items-center gap-2 px-3 py-1.5 rounded-win bg-accent-primary text-white hover:opacity-90 transition-opacity text-sm"
          >
            <Send size={13} />
            {t("bugReport.send")}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-1.5 rounded-win border border-border-primary text-text-primary hover:bg-bg-hover transition-colors text-sm"
          >
            {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
            {t("bugReport.copy")}
          </button>
          {copied && <span className="text-xs text-green-400">{t("bugReport.copied")}</span>}
          {openError && <span className="text-xs text-red-400">{t("bugReport.openFailed")}</span>}
        </div>
        <p className="text-text-muted text-xs flex items-start gap-1.5">
          <ExternalLink size={12} className="shrink-0 mt-0.5" />
          {t("bugReport.sendHelp")}
        </p>
      </div>
    </div>
  );
}

function TextAreaRow({ label, placeholder, value, onChange, rows = 3 }: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div className="form-row">
      <label className="text-text-secondary text-xs block mb-1">{label}</label>
      <textarea
        value={value}
        placeholder={placeholder}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-bg-input border border-border-primary rounded-win px-3 py-2
                   text-text-primary text-sm focus:outline-none focus:border-accent-primary
                   transition-colors duration-150 resize-y"
      />
    </div>
  );
}

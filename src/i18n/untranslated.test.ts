/// <reference types="vite/client" />
// @vitest-environment node
/**
 * Garde-fou i18n : aucun texte visible écrit en dur dans les composants. Le code des
 * composants est analysé avec le compilateur TypeScript (pas d'expressions régulières
 * fragiles) : texte JSX, attributs visibles (title, placeholder, aria-label…) et
 * messages passés directement aux toasts doivent passer par `t()`.
 */
import { describe, it, expect } from "vitest";
import ts from "typescript";

/** Sources de tous les composants (chargées par Vite, sans accès au système de fichiers) */
const SOURCES = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx", "!../i18n/**", "!../test/**"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Attributs JSX dont la valeur est lue ou entendue par l'utilisateur */
const VISIBLE_ATTRIBUTES = new Set(["title", "placeholder", "aria-label", "alt", "label", "message", "confirmLabel", "cancelLabel", "description"]);
/** Fonctions de notification : leur premier argument est affiché */
const TOAST_FUNCTIONS = new Set(["success", "error", "info", "warning", "addToast"]);

/**
 * Textes qui restent identiques dans toutes les langues : noms de produits et de
 * protocoles, unités, sigles. Tout le reste passe par le dictionnaire.
 */
const UNIVERSAL = new Set([
  "SSH", "WoL", "CPU", "RAM", "Docker", "Proxmox", "Ansible", "Loki", "ntfy", "Discord", "Telegram",
  "Windows Hello", "PIN", "IP", "MAC", "URL", "TLS", "HTTP", "HTTPS", "TCP", "JSON", "API", "VM", "CT",
  "Server Manager", "Power Control", "Server Power Manager", "Ctrl", "K", "Off", "Reboot", "OK",
  "Wake-on-LAN", "HTTP(S)", "AES-256-GCM", "Tauri v2 + React 18 + Rust", "CPU · 30 min", "RAM · 30 min",
  // Exemples de saisie, commandes et valeurs techniques affichés tels quels
  "PVE1", "https://192.168.1.10:8006", "root@pam!server-manager", "AA:BB:CC:DD:EE:FF", "root", "sudo",
  "df -h uptime", "Ctrl+C", "cron", "data.version", "Zabbix", "docker compose up -d",
]);

/** Contient au moins deux lettres consécutives et n'est pas un texte universel */
function isTranslatable(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  return /\p{L}{2,}/u.test(t) && !UNIVERSAL.has(t);
}

function findHardcoded(file: string, code: string): string[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push(`${file.replace(/^\.\.\//, "")}:${line + 1} « ${text.replace(/\s+/g, " ").trim()} »`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && isTranslatable(node.text)) report(node, node.text);
    if (ts.isJsxAttribute(node) && VISIBLE_ATTRIBUTES.has(node.name.getText(source)) && node.initializer) {
      const init = node.initializer;
      const literal = ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression) ? init.expression : null;
      if (literal && isTranslatable(literal.text)) report(literal, literal.text);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TOAST_FUNCTIONS.has(node.expression.text)) {
      const first = node.arguments[0];
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) && isTranslatable(first.text)) report(first, first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("i18n", () => {
  it("aucun texte visible n'est écrit en dur dans les composants", () => {
    const files = Object.entries(SOURCES);
    expect(files.length).toBeGreaterThan(50);
    const hardcoded = files.flatMap(([file, code]) => findHardcoded(file, code));
    expect(hardcoded, hardcoded.join("\n")).toEqual([]);
  });
});

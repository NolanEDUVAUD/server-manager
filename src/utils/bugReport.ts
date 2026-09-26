/**
 * Rapport de bug (Paramètres → Signaler un problème) : construction pure de l'URL
 * « new issue » GitHub et du texte du rapport, sans aucun appel réseau ni accès au
 * DOM — testable directement. Le formulaire n'envoie jamais rien lui-même : il ouvre
 * une issue pré-remplie dans le navigateur (`open_external_url`, restreint à github.com)
 * ou copie le texte dans le presse-papier.
 *
 * Volontairement absent des informations système : IP, identifiants, clés, noms d'hôte.
 */
import { REPO_URL } from "./support";

/** Informations système jointes si la case correspondante est cochée */
export interface BugReportSystemInfo {
  appVersion: string;
  /** Plateforme (`navigator.platform`/`userAgent`), jamais le nom de machine */
  platform: string;
  language: string;
  enabledModules: string[];
}

export interface BugReportInput {
  title: string;
  description: string;
  stepsToReproduce: string;
  expected: string;
  actual: string;
  /** `null`/`undefined` : case « inclure les informations système » décochée */
  systemInfo?: BugReportSystemInfo | null;
}

/** Longueur maximale du corps envoyé à GitHub (le reste de l'URL doit tenir dans les navigateurs) */
export const MAX_BODY_CHARS = 6000;

const TRUNCATION_NOTE = "\n\n*(rapport tronqué : dépasse la longueur maximale du lien GitHub)*";

/** Coupe `s` à `max` caractères sans jamais couper un caractère au milieu, note ajoutée */
export function truncateReportBody(s: string, max: number = MAX_BODY_CHARS): string {
  if ([...s].length <= max) return s;
  const room = Math.max(0, max - TRUNCATION_NOTE.length);
  const cut = [...s].slice(0, room).join("");
  return `${cut}${TRUNCATION_NOTE}`;
}

/** Une section n'apparaît dans le corps que si elle a un contenu */
function section(title: string, body: string): string {
  return body.trim() ? `### ${title}\n\n${body.trim()}\n` : "";
}

/** Section "Informations système", ou chaîne vide si non incluse */
function systemInfoSection(info?: BugReportSystemInfo | null): string {
  if (!info) return "";
  const modules = info.enabledModules.length > 0 ? info.enabledModules.join(", ") : "—";
  return section(
    "Informations système",
    [
      `- Version de l'application : ${info.appVersion}`,
      `- Plateforme : ${info.platform}`,
      `- Langue : ${info.language}`,
      `- Modules activés : ${modules}`,
    ].join("\n")
  );
}

/** Corps de l'issue GitHub (Markdown), tronqué à `MAX_BODY_CHARS` caractères */
export function buildBugReportBody(input: BugReportInput): string {
  const raw = [
    section("Description", input.description),
    section("Étapes pour reproduire", input.stepsToReproduce),
    section("Comportement attendu", input.expected),
    section("Comportement observé", input.actual),
    systemInfoSection(input.systemInfo),
  ]
    .filter(Boolean)
    .join("\n");
  return truncateReportBody(raw.trim() || "(aucune description fournie)");
}

/** Texte complet du rapport (titre + corps), utilisé pour « Copier le rapport » */
export function buildBugReportText(input: BugReportInput): string {
  const title = input.title.trim() || "(sans titre)";
  return `${title}\n\n${buildBugReportBody(input)}`;
}

/**
 * Longueur maximale de l'adresse « new issue » elle-même : au-delà, certains navigateurs
 * (et GitHub) refusent ou tronquent silencieusement la requête. Choisie avec une marge
 * sous la limite pratique généralement citée (~8000 caractères).
 */
export const MAX_ISSUE_URL_CHARS = 7500;

function issueUrl(repoUrl: string, title: string, body: string): string {
  const params = new URLSearchParams({ title, body, labels: "bug" });
  return `${repoUrl}/issues/new?${params.toString()}`;
}

/**
 * Adresse « nouvelle issue » GitHub, pré-remplie et encodée, dont la longueur totale ne
 * dépasse jamais `MAX_ISSUE_URL_CHARS`. `buildBugReportBody` borne déjà le corps à
 * `MAX_BODY_CHARS`, mais l'encodage (accents, retours à la ligne en `%0A`…) peut à lui
 * seul dépasser ce budget ; le corps est alors encore réduit, par recherche dichotomique
 * sur le nombre de caractères conservés, jusqu'à ce que l'adresse encodée tienne dans la
 * limite. `repoUrl` n'est paramétrable que pour les tests : en production c'est toujours
 * `REPO_URL` (github.com/…, seule adresse autorisée par `open_external_url`).
 */
export function buildBugReportIssueUrl(input: BugReportInput, repoUrl: string = REPO_URL): string {
  const title = input.title.trim() || "(sans titre)";
  const body = buildBugReportBody(input);
  const url = issueUrl(repoUrl, title, body);
  if (url.length <= MAX_ISSUE_URL_CHARS) return url;

  let lo = 0;
  let hi = [...body].length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = issueUrl(repoUrl, title, truncateReportBody(body, mid));
    if (candidate.length <= MAX_ISSUE_URL_CHARS) lo = mid;
    else hi = mid - 1;
  }
  return issueUrl(repoUrl, title, truncateReportBody(body, lo));
}

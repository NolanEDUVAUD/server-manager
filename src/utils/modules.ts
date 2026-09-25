import { t } from "../i18n";
import type { Dict } from "../i18n";

/** Modules optionnels : chacun peut être masqué de la barre latérale selon ce qu'on utilise */
export interface AppModule {
  key: string;
  /** Libellé et description traduits dans la langue active, lus au moment de l'affichage */
  readonly label: string;
  readonly description: string;
  /** Proposé par défaut au premier lancement */
  essential: boolean;
}

type ModuleKey = keyof Dict["modules"];

/** Textes résolus à chaque lecture (jamais à l'import) : ils suivent le changement de langue */
function defineModule(key: ModuleKey, essential: boolean): AppModule {
  return {
    key,
    essential,
    get label() {
      return t(`modules.${key}.label` as const);
    },
    get description() {
      return t(`modules.${key}.description` as const);
    },
  };
}

export const MODULES: AppModule[] = [
  defineModule("power", true),
  defineModule("resources", true),
  defineModule("services", true),
  defineModule("console", true),
  defineModule("history", true),
  defineModule("alerts", true),
  defineModule("network", false),
  defineModule("docker", false),
  defineModule("batch", false),
  defineModule("updates", false),
  defineModule("logs", false),
  defineModule("scheduler", false),
  defineModule("proxmox", false),
  defineModule("web", false),
];

/** Modules masqués pour ne garder que la sélection (utilisé par l'écran d'accueil) */
export function hiddenExcept(selected: string[]): string[] {
  return MODULES.map((m) => m.key).filter((k) => !selected.includes(k));
}

export function isVisible(module: string | undefined, hidden: string[]): boolean {
  return !module || !hidden.includes(module);
}

/**
 * Dictionnaire de référence (français). Chaque espace de noms vit dans son propre
 * fichier ; `en/` doit en reprendre exactement la structure (vérifié par tsc et par
 * i18n.test.ts). Ne jamais nommer une clé « other » : c'est la forme plurielle.
 */
import { common } from "./common";
import { settings } from "./settings";

export const fr = {
  common,
  settings,
};

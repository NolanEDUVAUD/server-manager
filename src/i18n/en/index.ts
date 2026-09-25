/** Dictionnaire anglais : même structure que `fr/` (vérifiée par le type `Dict`) */
import type { Dict } from "..";
import { backup } from "./backup";
import { common } from "./common";
import { settings } from "./settings";

export const en: Dict = {
  backup,
  common,
  settings,
};

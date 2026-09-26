/**
 * Contrat de licence (EULA), en anglais uniquement.
 *
 * Source unique : src-tauri/EULA.txt, affiché par l'installateur (bundle.licenseFile)
 * et importé tel quel ici — l'application et l'installateur montrent donc toujours le
 * même texte. Changer EULA_VERSION à chaque modification du texte : l'application
 * redemande alors l'acceptation au lancement suivant.
 */
import eulaRaw from "../../src-tauri/EULA.txt?raw";

export const EULA_VERSION = "2.0.0";

export const eulaText: string = eulaRaw;

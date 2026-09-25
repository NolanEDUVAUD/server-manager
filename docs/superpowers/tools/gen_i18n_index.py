"""Régénère src/i18n/{fr,en}/index.ts à partir des fichiers d'espaces de noms présents."""
import os, re, sys
root = sys.argv[1] if len(sys.argv) > 1 else "src/i18n"
HEADERS = {
    "fr": '''/**
 * Dictionnaire de référence (français). Chaque espace de noms vit dans son propre
 * fichier ; `en/` doit en reprendre exactement la structure (vérifié par tsc et par
 * i18n.test.ts). Ne jamais nommer une clé « other » : c'est la forme plurielle.
 */
''',
    "en": '''/** Dictionnaire anglais : même structure que `fr/` (vérifiée par le type `Dict`) */
import type { Dict } from "..";
''',
}
for lang in ("fr", "en"):
    d = os.path.join(root, lang)
    entries = []
    for f in sorted(os.listdir(d)):
        if not f.endswith(".ts") or f == "index.ts":
            continue
        ns = f[:-3]
        src = open(os.path.join(d, f)).read()
        m = re.search(r"export const (\w+)\s*(?::|=)", src)
        assert m, f
        entries.append((ns, m.group(1)))
    lines = [HEADERS[lang]]
    for ns, var in entries:
        lines.append(f'import {{ {var} }} from "./{ns}";\n')
    decl = "export const fr = {\n" if lang == "fr" else "export const en: Dict = {\n"
    lines.append("\n" + decl)
    for ns, var in entries:
        lines.append(f"  {var},\n" if ns == var else f"  {ns}: {var},\n")
    lines.append("};\n")
    open(os.path.join(d, "index.ts"), "w").write("".join(lines))
    print(lang, len(entries), "espaces de noms")

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { useStore } from "../stores/useStore";
import { SHORTCUTS, ShortcutDef, shortcutKeys } from "../utils/shortcuts";
import { t } from "../i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

describe("aide des raccourcis clavier", () => {
  beforeEach(() => useStore.setState({ shortcutsHelpOpen: false }));

  it("s'ouvre avec « ? » et liste exactement la table des raccourcis", () => {
    const { container } = render(<ShortcutsHelp />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { fireEvent.keyDown(window, { key: "?" }); });
    const dialog = screen.getByRole("dialog", { name: "Raccourcis clavier" });

    // Une ligne par entrée de la table, ni plus ni moins, avec sa description et ses touches
    const rows = [...container.querySelectorAll("[data-shortcut]")].map((li) => li.getAttribute("data-shortcut"));
    expect(rows.sort()).toEqual(SHORTCUTS.map((s) => s.id).sort());
    for (const s of SHORTCUTS as readonly ShortcutDef[]) {
      const row = container.querySelector(`[data-shortcut="${s.id}"]`) as HTMLElement;
      expect(within(row).getByText(t(s.descriptionKey))).toBeTruthy();
      const shown = [...row.querySelectorAll("kbd")].map((k) => k.textContent);
      expect(shown).toEqual(shortcutKeys(s).flat());
    }
    expect(within(dialog).getAllByText("Ctrl").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Maj")).toBeTruthy();
    expect(within(dialog).getByText("Aller aux serveurs")).toBeTruthy();
    expect(within(dialog).getByText("Navigation")).toBeTruthy();
  });

  it("se ferme avec Échap, et « ? » est ignoré pendant la saisie", () => {
    render(<><input aria-label="champ" /><ShortcutsHelp /></>);
    const field = screen.getByLabelText("champ");
    act(() => { fireEvent.keyDown(field, { key: "?" }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { fireEvent.keyDown(window, { key: "?" }); });
    expect(screen.getByRole("dialog")).toBeTruthy();
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

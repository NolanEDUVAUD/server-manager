import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { LanguageSelect } from "./LanguageSelect";
import { useStore } from "../stores/useStore";
import { currentLang, setLanguage } from "../i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

describe("LanguageSelect", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    useStore.setState((s) => ({ settings: { ...s.settings, general: { ...s.settings.general, language: "fr" } } }));
  });
  afterEach(() => setLanguage("fr"));

  it("bascule l'interface en anglais et enregistre le réglage", async () => {
    render(<LanguageSelect />);
    expect(screen.getByLabelText("Langue de l'interface")).toHaveValue("fr");

    fireEvent.change(screen.getByLabelText("Langue de l'interface"), { target: { value: "en" } });

    await waitFor(() => expect(currentLang()).toBe("en"));
    expect(invoke).toHaveBeenCalledWith("update_settings", expect.objectContaining({
      settings: expect.objectContaining({ general: expect.objectContaining({ language: "en" }) }),
    }));
    // Le libellé du composant lui-même suit la nouvelle langue
    expect(await screen.findByLabelText("Interface language")).toHaveValue("en");
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { Dropdown } from "./Dropdown";

/** Petit harnais : un bouton déclencheur + le menu, comme dans les usages réels. */
function Harness({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={ref}>trigger</button>
      <Dropdown open onClose={onClose} anchorRef={ref}>
        <div>contenu du menu</div>
      </Dropdown>
    </div>
  );
}

describe("Dropdown", () => {
  it("rend son contenu dans un portail attaché à document.body (pas dans un conteneur parent)", () => {
    const { container } = render(<Harness onClose={() => {}} />);
    // Le menu n'est pas un enfant du conteneur de rendu local...
    expect(container.querySelector("div")?.textContent).not.toContain("contenu du menu");
    // ...mais il est bien présent quelque part dans le document (portail vers body).
    expect(screen.getByText("contenu du menu")).toBeInTheDocument();
    expect(document.body.contains(screen.getByText("contenu du menu"))).toBe(true);
  });

  it("se ferme au clic en dehors du menu et du déclencheur", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("ne se ferme pas au clic sur le déclencheur (c'est lui qui gère le toggle)", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.mouseDown(screen.getByText("trigger"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ne se ferme pas au clic à l'intérieur du menu", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.mouseDown(screen.getByText("contenu du menu"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("se ferme sur Échap", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("se ferme au scroll ou au redimensionnement de la fenêtre", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.scroll(window);
    expect(onClose).toHaveBeenCalledTimes(1);

    const onClose2 = vi.fn();
    render(<Harness onClose={onClose2} />);
    fireEvent.resize(window);
    expect(onClose2).toHaveBeenCalled();
  });

  it("ne rend rien quand open est faux", () => {
    function ClosedHarness() {
      const ref = useRef<HTMLButtonElement>(null);
      return (
        <div>
          <button ref={ref}>trigger</button>
          <Dropdown open={false} onClose={() => {}} anchorRef={ref}>
            <div>contenu du menu</div>
          </Dropdown>
        </div>
      );
    }
    render(<ClosedHarness />);
    expect(screen.queryByText("contenu du menu")).not.toBeInTheDocument();
  });
});

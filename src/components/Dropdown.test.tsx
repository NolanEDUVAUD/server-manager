import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useRef, RefObject } from "react";
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

  it("ne se ferme pas au scroll à l'intérieur du menu (ex. une longue liste)", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.scroll(screen.getByText("contenu du menu"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ne se ferme pas au scroll ou au redimensionnement en dehors du menu : il se repositionne", () => {
    const onClose = vi.fn();
    const ref = { current: document.createElement("button") } as RefObject<HTMLButtonElement>;
    // Ancre toujours visible (rect non nul) : le menu doit se repositionner, pas se fermer.
    ref.current!.getBoundingClientRect = () =>
      ({ top: 40, bottom: 60, left: 10, right: 100, width: 90, height: 20, x: 10, y: 40, toJSON() {} }) as DOMRect;
    document.body.appendChild(ref.current!);

    function Harness2() {
      return (
        <Dropdown open onClose={onClose} anchorRef={ref}>
          <div>contenu du menu</div>
        </Dropdown>
      );
    }
    render(<Harness2 />);

    fireEvent.scroll(window);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.resize(window);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("se ferme quand le déclencheur sort entièrement de la zone visible au scroll", async () => {
    const onClose = vi.fn();
    const ref = { current: document.createElement("button") } as RefObject<HTMLButtonElement>;
    // Ancre poussée hors de l'écran (ex. scroll d'un panneau parent) : plus de repère,
    // le menu doit se fermer plutôt que flotter n'importe où.
    ref.current!.getBoundingClientRect = () =>
      ({ top: -200, bottom: -180, left: 10, right: 100, width: 90, height: 20, x: 10, y: -200, toJSON() {} }) as DOMRect;
    document.body.appendChild(ref.current!);

    function Harness3() {
      return (
        <Dropdown open onClose={onClose} anchorRef={ref}>
          <div>contenu du menu</div>
        </Dropdown>
      );
    }
    render(<Harness3 />);

    fireEvent.scroll(window);
    // Le recalcul est planifié via requestAnimationFrame (au plus une fois par frame).
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(onClose).toHaveBeenCalled();
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

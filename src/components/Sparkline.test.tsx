import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("ne dessine rien avec moins de deux points", () => {
    const { container } = render(<Sparkline values={[42]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("répartit les points sur la largeur et inverse l'axe vertical", () => {
    const { container } = render(<Sparkline values={[0, 50, 100]} />);
    const points = container.querySelector("polyline")!.getAttribute("points");
    expect(points).toBe("0.00,100.00 50.00,50.00 100.00,0.00");
  });

  it("borne les valeurs hors de 0-100", () => {
    const { container } = render(<Sparkline values={[-10, 150]} />);
    const points = container.querySelector("polyline")!.getAttribute("points");
    expect(points).toBe("0.00,100.00 100.00,0.00");
  });
});

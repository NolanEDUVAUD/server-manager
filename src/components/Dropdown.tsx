import { ReactNode, RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../utils";

interface DropdownProps {
  open: boolean;
  onClose: () => void;
  /** Élément déclencheur : sert à calculer la position et à l'exclure du clic extérieur */
  anchorRef: RefObject<HTMLElement>;
  /** Alignement horizontal du menu par rapport au déclencheur */
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
}

/**
 * Menu/popover générique rendu dans un portail (document.body), positionné en `fixed`
 * à partir du rectangle du déclencheur. Contrairement à un `absolute` imbriqué dans la
 * page, il ne peut jamais être rogné par un `overflow-hidden`/`overflow-x-auto` parent
 * ni recouvert par un contexte d'empilement local (ex. le rendu WebGL/canvas d'xterm
 * dans la Console) : sa position dans le DOM ne dépend plus de celle du déclencheur.
 *
 * Se ferme au clic extérieur et à Échap. Un scroll ou un redimensionnement NE le ferme
 * plus : un scroll qui a lieu à l'intérieur du menu (ex. une longue liste, un sélecteur
 * de serveur) ne doit jamais le fermer, et un scroll ailleurs sur la page (ou un
 * redimensionnement de la fenêtre) recalcule simplement sa position à partir du
 * rectangle du déclencheur — le menu suit son ancre au lieu de se détacher d'elle.
 * Il ne se ferme que si le déclencheur sort entièrement de la zone visible (repère
 * disparu, plus aucune position sensée à calculer).
 */
export function Dropdown({ open, onClose, anchorRef, align = "left", className, children }: DropdownProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    // Position provisoire (hauteur du menu pas encore connue) : mesurée juste après,
    // une fois le menu monté, pour décider s'il faut le retourner vers le haut.
    setPos({ top: rect.bottom + 4, left: rect.left, right: window.innerWidth - rect.right });
  }, [open, anchorRef]);

  useLayoutEffect(() => {
    if (!open || !pos) return;
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const rect = anchor.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const flipUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const top = flipUp ? Math.max(4, rect.top - menuHeight - 4) : rect.bottom + 4;
    if (top !== pos.top) setPos((p) => (p ? { ...p, top } : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos?.left, pos?.right]);

  useEffect(() => {
    if (!open) return;

    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    // Recalcule la position à partir de l'ancre, sans repasser par React tant que rien
    // n'a changé — au plus une fois par frame, pour rester fluide pendant un scroll.
    let rafId: number | null = null;
    function reposition() {
      rafId = null;
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const fullyOutOfView =
        rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth;
      if (fullyOutOfView) {
        // Le déclencheur a totalement disparu de la zone visible (page ou panneau
        // défilé) : plus aucun repère pour positionner le menu, on referme.
        onClose();
        return;
      }
      const menu = menuRef.current;
      const menuHeight = menu?.offsetHeight ?? 0;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const flipUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
      const top = flipUp ? Math.max(4, rect.top - menuHeight - 4) : rect.bottom + 4;
      setPos({ top, left: rect.left, right: window.innerWidth - rect.right });
    }
    function onScroll(e: Event) {
      // Un scroll survenu à l'intérieur même du menu (liste longue, sélecteur défilant)
      // ne doit ni le fermer ni le repositionner : seul un scroll ailleurs sur la page
      // (potentiellement un parent qui déplace le déclencheur) doit le suivre.
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(reposition);
    }
    function onResize() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(reposition);
    }

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // capture: true pour intercepter le scroll de n'importe quel ancêtre défilant, pas
    // seulement window (ex. un panneau interne avec overflow-y-auto).
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: pos?.top ?? -9999,
        ...(align === "right" ? { right: pos?.right ?? -9999 } : { left: pos?.left ?? -9999 }),
        visibility: pos ? "visible" : "hidden",
      }}
      className={cn("z-dropdown", className)}
    >
      {children}
    </div>,
    document.body
  );
}

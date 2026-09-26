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
 * Se ferme au clic extérieur, à Échap, et au scroll/redimensionnement (sa position
 * calculée une fois à l'ouverture ne suivrait pas la page, mieux vaut refermer que
 * laisser le menu se détacher visuellement de son déclencheur).
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
    function close() {
      onClose();
    }
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
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

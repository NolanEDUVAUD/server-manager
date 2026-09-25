import { useEffect, useRef } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useStore } from "../stores/useStore";
import { TerminalSession } from "../types";
import { cn } from "../utils";

/** Message du backend : octets du terminal (ArrayBuffer) ou fin de session (JSON). */
type TerminalEvent = ArrayBuffer | { closed: string };

const GREY = "\x1b[90m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

/** Couleurs du thème actif de l'app, lues dans les variables CSS. */
function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v("--bg-primary", "#1e1e1e"),
    foreground: v("--text-primary", "#e6e6e6"),
    cursor: v("--accent-primary", "#0078d4"),
    selectionBackground: "rgba(0, 120, 212, 0.35)",
  };
}

interface TerminalViewProps {
  session: TerminalSession;
  active: boolean;
}

/**
 * Un terminal xterm.js relié à une session SSH côté Rust. L'instance xterm vit
 * aussi longtemps que le composant ; une reconnexion (attempt + 1) réutilise
 * le même terminal et garde donc l'historique affiché.
 */
export function TerminalView({ session, active }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Lu par les callbacks xterm (onData/onResize) : doit toujours refléter la session courante
  const sessionIdRef = useRef<string | null>(null);
  const updateTerminal = useStore((s) => s.updateTerminal);

  // Ajuste le terminal à son conteneur ; impossible tant que l'onglet est masqué (taille nulle)
  function fit() {
    const el = containerRef.current;
    if (el && el.offsetWidth > 0 && el.offsetHeight > 0) fitRef.current?.fit();
  }

  // ── Création de l'instance xterm (une seule fois) ──────────────────────
  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: readTheme(),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current!);
    termRef.current = term;
    fitRef.current = fitAddon;
    fit();

    const onData = term.onData((data) => {
      const id = sessionIdRef.current;
      if (id) invoke("terminal_write", { sessionId: id, data }).catch(() => {});
    });
    const onResize = term.onResize(({ cols, rows }) => {
      const id = sessionIdRef.current;
      if (id) invoke("terminal_resize", { sessionId: id, cols, rows }).catch(() => {});
    });
    const observer = new ResizeObserver(fit);
    observer.observe(containerRef.current!);

    return () => {
      observer.disconnect();
      onData.dispose();
      onResize.dispose();
      term.dispose();
    };
  }, []);

  // ── Connexion SSH (relancée à chaque reconnexion) ──────────────────────
  useEffect(() => {
    const term = termRef.current!;
    const { key, serverId, title, attempt } = session;
    let cancelled = false;
    sessionIdRef.current = null;
    fit();
    term.write(`${attempt > 0 ? "\r\n" : ""}${GREY}Connexion à ${title}…${RESET}\r\n`);

    const channel = new Channel<TerminalEvent>();
    channel.onmessage = (msg) => {
      // Connexion abandonnée (reconnexion, ou double montage de React StrictMode en dev) :
      // sa fin de session ne doit pas marquer comme fermée la connexion qui l'a remplacée
      if (cancelled) return;
      if (msg instanceof ArrayBuffer) {
        term.write(new Uint8Array(msg));
        return;
      }
      sessionIdRef.current = null;
      updateTerminal(key, { status: "closed", closedReason: msg.closed, sessionId: undefined });
      term.write(`\r\n${GREY}[${msg.closed}]${RESET}\r\n`);
    };

    invoke<string>("terminal_open", { serverId, cols: term.cols, rows: term.rows, onEvent: channel })
      .then((sessionId) => {
        if (cancelled) {
          // Onglet fermé pendant la connexion : on libère aussitôt la session
          invoke("terminal_close", { sessionId }).catch(() => {});
          return;
        }
        sessionIdRef.current = sessionId;
        // Ne pas repasser en « open » si la fin de session est déjà arrivée
        const current = useStore.getState().terminalSessions.find((t) => t.key === key);
        if (current?.status === "connecting") updateTerminal(key, { status: "open", sessionId });
        term.focus();
      })
      .catch((e) => {
        if (cancelled) return;
        updateTerminal(key, { status: "closed", closedReason: String(e) });
        term.write(`${RED}${String(e)}${RESET}\r\n`);
      });

    return () => {
      cancelled = true;
    };
    // Seule une reconnexion explicite doit relancer la connexion
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.attempt]);

  // ── Onglet devenu visible : recalage de la taille et focus clavier ─────
  useEffect(() => {
    if (!active) return;
    // Attendre que le conteneur ait été rendu visible avant de mesurer
    const frame = requestAnimationFrame(() => {
      fit();
      termRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return (
    <div className={cn("absolute inset-0 p-2", active ? "block" : "hidden")}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

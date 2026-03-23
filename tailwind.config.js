/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // === NOUVELLES CLÉS CSS VARIABLES (thème dynamique) ===
        'bg-primary':    'var(--bg-primary)',
        'bg-secondary':  'var(--bg-secondary)',
        'bg-tertiary':   'var(--bg-tertiary)',
        'bg-input':      'var(--bg-input)',
        'bg-hover':      'var(--bg-hover)',
        'bg-active':     'var(--bg-active)',
        'text-primary':  'var(--text-primary)',
        'text-secondary':'var(--text-secondary)',
        'text-muted':    'var(--text-muted)',
        'accent-primary':  'var(--accent-primary)',
        'accent-secondary':'var(--accent-secondary)',
        'accent-success':  'var(--accent-success)',
        'accent-warning':  'var(--accent-warning)',
        'accent-error':    'var(--accent-error)',
        'accent-info':     'var(--accent-info)',
        'border-primary':  'var(--border-primary)',
        'border-secondary':'var(--border-secondary)',
        // Palette Windows 11 / Fluent Design
        win: {
          bg: "#0a0a0f",         // Fond principal très sombre
          surface: "#111117",    // Surface secondaire
          card: "#16161e",       // Fond des cartes
          border: "#2a2a3a",     // Bordures
          hover: "#1e1e2e",      // Hover état
          accent: "#0078d4",     // Bleu Windows 11
          "accent-hover": "#1084d8",
          "accent-light": "#106ebe",
          muted: "#94a3b8",      // Texte secondaire
          text: "#e2e8f0",       // Texte principal
        },
        status: {
          online: "#22c55e",
          offline: "#ef4444",
          unknown: "#6b7280",
          warning: "#f59e0b",
        },
      },
      fontFamily: {
        sans: ['"Segoe UI Variable"', '"Segoe UI"', "Inter", "sans-serif"],
      },
      borderRadius: {
        win: "8px",
        "win-lg": "12px",
      },
      boxShadow: {
        win: "0 2px 8px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05)",
        "win-hover": "0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)",
      },
      animation: {
        "fade-in": "fadeIn 150ms ease-out",
        "slide-in": "slideIn 200ms ease-out",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideIn: {
          "0%": { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
      },
    },
  },
  plugins: [],
};

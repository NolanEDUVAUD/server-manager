/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // === CLÉS CSS VARIABLES (thème dynamique) ===
        // color-mix + <alpha-value> : sans ça, Tailwind ignore silencieusement les
        // modificateurs d'opacité (bg-accent-primary/10, border-accent-info/20…)
        // sur des couleurs var(), et la bordure retombe sur le gris clair par défaut.
        'bg-primary':    'color-mix(in srgb, var(--bg-primary) calc(<alpha-value> * 100%), transparent)',
        'bg-secondary':  'color-mix(in srgb, var(--bg-secondary) calc(<alpha-value> * 100%), transparent)',
        'bg-tertiary':   'color-mix(in srgb, var(--bg-tertiary) calc(<alpha-value> * 100%), transparent)',
        'bg-input':      'color-mix(in srgb, var(--bg-input) calc(<alpha-value> * 100%), transparent)',
        'bg-hover':      'color-mix(in srgb, var(--bg-hover) calc(<alpha-value> * 100%), transparent)',
        'bg-active':     'color-mix(in srgb, var(--bg-active) calc(<alpha-value> * 100%), transparent)',
        'text-primary':  'color-mix(in srgb, var(--text-primary) calc(<alpha-value> * 100%), transparent)',
        'text-secondary':'color-mix(in srgb, var(--text-secondary) calc(<alpha-value> * 100%), transparent)',
        'text-muted':    'color-mix(in srgb, var(--text-muted) calc(<alpha-value> * 100%), transparent)',
        'accent-primary':  'color-mix(in srgb, var(--accent-primary) calc(<alpha-value> * 100%), transparent)',
        'accent-secondary':'color-mix(in srgb, var(--accent-secondary) calc(<alpha-value> * 100%), transparent)',
        'accent-success':  'color-mix(in srgb, var(--accent-success) calc(<alpha-value> * 100%), transparent)',
        'accent-warning':  'color-mix(in srgb, var(--accent-warning) calc(<alpha-value> * 100%), transparent)',
        'accent-error':    'color-mix(in srgb, var(--accent-error) calc(<alpha-value> * 100%), transparent)',
        'accent-info':     'color-mix(in srgb, var(--accent-info) calc(<alpha-value> * 100%), transparent)',
        'border-primary':  'color-mix(in srgb, var(--border-primary) calc(<alpha-value> * 100%), transparent)',
        'border-secondary':'color-mix(in srgb, var(--border-secondary) calc(<alpha-value> * 100%), transparent)',
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
      // Échelle unique de superposition : tout le monde s'y réfère (z-dropdown, z-modal…)
      // pour éviter les z-index ad hoc qui finissent par se chevaucher au hasard.
      zIndex: {
        dropdown: "50",
        modal: "60",
        toast: "70",
        palette: "80",
        lock: "100",
      },
      animation: {
        "fade-in": "fadeIn 150ms ease-out",
        "slide-in": "slideIn 200ms ease-out",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
        // Mini-exemple du tutoriel (Favoris & personnalisation) : glisser un onglet en boucle
        "tour-drag": "tourDrag 2.4s ease-in-out infinite",
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
        tourDrag: {
          "0%, 15%": { left: "132px", opacity: "1" },
          "45%, 65%": { left: "12px", opacity: "1" },
          "85%, 100%": { left: "132px", opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};

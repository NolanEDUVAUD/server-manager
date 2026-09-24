import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Empêche vite de masquer les erreurs Rust
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Ignorer les changements côté Rust pour éviter les rechargements intempestifs
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Empêche Vitest de scanner les copies de src/ dans les worktrees imbriqués
    // (sinon deux instances de React sont chargées et les tests y échouent)
    exclude: ["**/node_modules/**", "**/.worktrees/**"],
  },
}));

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
}));

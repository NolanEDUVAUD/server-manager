import { useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Servers } from "./pages/Servers";
import { Groups } from "./pages/Groups";
import { Proxmox } from "./pages/Proxmox";
import { Dashboards } from "./pages/Dashboards";
import { Resources } from "./pages/Resources";
import { Settings } from "./pages/Settings";
import { useStore } from "./stores/useStore";
import { usePing } from "./hooks/usePing";
import { useMetrics } from "./hooks/useMetrics";

function AppContent() {
  const { initialize, loading } = useStore();

  // Charger les données Tauri au démarrage
  useEffect(() => {
    initialize().catch(console.error);
  }, []);

  // Démarrer le ping automatique
  usePing();

  // Collecter les ressources (CPU / RAM / disques) des serveurs en ligne
  useMetrics();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-primary">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
          <p className="text-text-secondary text-sm">Chargement…</p>
        </div>
      </div>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/servers" element={<Servers />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/proxmox" element={<Proxmox />} />
        <Route path="/dashboards" element={<Dashboards />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

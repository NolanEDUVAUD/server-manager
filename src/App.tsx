import { useEffect } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Servers } from "./pages/Servers";
import { Groups } from "./pages/Groups";
import { Proxmox } from "./pages/Proxmox";
import { Dashboards } from "./pages/Dashboards";
import { Resources } from "./pages/Resources";
import { History } from "./pages/History";
import { Scheduler } from "./pages/Scheduler";
import { Docker } from "./pages/Docker";
import { Alerts } from "./pages/Alerts";
import { Services } from "./pages/Services";
import { Backups } from "./pages/Backups";
import { LabPower } from "./pages/LabPower";
import { Settings } from "./pages/Settings";
import { useStore } from "./stores/useStore";
import { usePing } from "./hooks/usePing";
import { useMetrics } from "./hooks/useMetrics";
import { useEventFeed } from "./hooks/useEventFeed";
import { useTraySync } from "./hooks/useTraySync";

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

  // Historique des événements (chargement + flux en direct)
  useEventFeed();

  // Infobulle et menu de l'icône de zone de notification
  useTraySync();

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
        <Route path="/history" element={<History />} />
        <Route path="/scheduler" element={<Scheduler />} />
        <Route path="/docker" element={<Docker />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/services" element={<Services />} />
        <Route path="/backups" element={<Backups />} />
        <Route path="/lab-power" element={<LabPower />} />
        {/* Rendue en permanence par Layout, la route sert juste à l'activer */}
        <Route path="/console" element={null} />
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

/** Modules optionnels : chacun peut être masqué de la barre latérale selon ce qu'on utilise */
export interface AppModule {
  key: string;
  label: string;
  description: string;
  /** Proposé par défaut au premier lancement */
  essential: boolean;
}

export const MODULES: AppModule[] = [
  { key: "power", label: "Arrêt / démarrage", description: "Éteindre ou rallumer tout le lab dans le bon ordre", essential: true },
  { key: "resources", label: "Ressources", description: "CPU, RAM et disques des serveurs en temps réel", essential: true },
  { key: "services", label: "Services", description: "Surveiller n'importe quel service web (catalogue Home Assistant, Jellyfin, Pi-hole…)", essential: true },
  { key: "console", label: "Console SSH", description: "Terminal SSH intégré avec onglets", essential: true },
  { key: "history", label: "Historique", description: "Journal des coupures, redémarrages et actions", essential: true },
  { key: "alerts", label: "Alertes", description: "Notifications ntfy, Discord, Telegram…", essential: true },
  { key: "network", label: "Réseau", description: "Appareils du réseau local et adresses MAC", essential: false },
  { key: "docker", label: "Docker", description: "Conteneurs et images des hôtes Docker", essential: false },
  { key: "batch", label: "Tâches en lot", description: "Un script sur plusieurs serveurs, playbooks Ansible", essential: false },
  { key: "updates", label: "Mises à jour", description: "Paquets apt en attente et conteneurs dépassés", essential: false },
  { key: "logs", label: "Logs", description: "Journaux centralisés dans Grafana Loki", essential: false },
  { key: "scheduler", label: "Planificateur", description: "Tâches programmées et cronjobs sur les serveurs", essential: false },
  { key: "proxmox", label: "Proxmox", description: "Cluster Proxmox VE : VM, conteneurs, sauvegardes, migration", essential: false },
  { key: "web", label: "Onglets web", description: "Interfaces web des services dans l'application", essential: false },
];

/** Modules masqués pour ne garder que la sélection (utilisé par l'écran d'accueil) */
export function hiddenExcept(selected: string[]): string[] {
  return MODULES.map((m) => m.key).filter((k) => !selected.includes(k));
}

export function isVisible(module: string | undefined, hidden: string[]): boolean {
  return !module || !hidden.includes(module);
}

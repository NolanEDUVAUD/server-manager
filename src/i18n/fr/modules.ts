/** Modules optionnels (écran d'accueil, Paramètres → Général → Modules) */
export const modules = {
  power: { label: "Arrêt / démarrage", description: "Éteindre ou rallumer tout le lab dans le bon ordre" },
  resources: { label: "Ressources", description: "CPU, RAM et disques des serveurs en temps réel" },
  console: { label: "Console SSH", description: "Terminal SSH intégré avec onglets" },
  history: { label: "Historique", description: "Journal des coupures, redémarrages et actions" },
  alerts: { label: "Alertes", description: "Notifications ntfy, Discord, Telegram…" },
  network: { label: "Réseau", description: "Appareils du réseau local et adresses MAC" },
  docker: { label: "Docker", description: "Conteneurs et images des hôtes Docker" },
  batch: { label: "Tâches en lot", description: "Un script sur plusieurs serveurs, playbooks Ansible" },
  updates: { label: "Mises à jour", description: "Paquets apt en attente et conteneurs dépassés" },
  logs: { label: "Logs", description: "Journaux centralisés dans Grafana Loki" },
  scheduler: { label: "Planificateur", description: "Tâches programmées et cronjobs sur les serveurs" },
  proxmox: { label: "Proxmox", description: "Cluster Proxmox VE : VM, conteneurs, sauvegardes, migration" },
  web: { label: "Onglets web", description: "Interfaces web des services dans l'application" },
};

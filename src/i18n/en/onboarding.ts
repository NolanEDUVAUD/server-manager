import type { Dict } from "..";

export const onboarding: Dict["onboarding"] = {
  welcome: "Welcome to Server Power Manager",
  intro: "Choose what you want to see in the sidebar. You can change everything later in Settings → General.",
  security: "Passwords and tokens are encrypted, with a key kept in Windows Credential Manager.",
  all: "All",
  start: "Get started",
};

/** Guided tour on first launch */
export const tour: Dict["tour"] = {
  welcome: {
    title: "Welcome!",
    text: "Server Power Manager centralizes your servers and services for simplified management.",
  },
  serversAndGroups: {
    title: "Servers and groups",
    text: "Add servers, create groups, run batch commands via Wake-on-LAN, shutdown and restart.",
  },
  dashboard: {
    title: "Dashboard and monitoring",
    text: "View the status of your servers, resources used and active alerts at a glance.",
  },
  ssh: {
    title: "SSH Console",
    text: "Integrated terminal for running saved commands directly from the application.",
  },
  batch: {
    title: "Batch tasks",
    text: "Run operations in parallel across multiple servers and monitor progress.",
  },
  network: {
    title: "Network",
    text: "Scan your network and visualize connections with the graph view.",
  },
  customization: {
    title: "Customization",
    text: "Drag tabs to reorganize them, mark your favorites, adjust sidebar width and density.",
  },
  settings: {
    title: "Settings",
    text: "Update the application, report an issue, explore extensions and support the project.",
  },
  prev: "Previous",
  next: "Next",
  skip: "Skip",
  done: "Done",
};

/** What's new modal */
export const whatsNew: Dict["whatsNew"] = {
  title: "What's new in version ",
  close: "Close",
};

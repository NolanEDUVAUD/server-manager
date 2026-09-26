import type { Dict } from "..";

export const onboarding: Dict["onboarding"] = {
  welcome: "Welcome to Server Power Manager",
  intro: "Choose what you want to see in the sidebar. You can change everything later in Settings → General.",
  security: "Passwords and tokens are encrypted, with a key kept in Windows Credential Manager.",
  all: "All",
  start: "Get started",
};

/** Interactive guided tour (coach-marks on the real sidebar) */
export const tour: Dict["tour"] = {
  dialogLabel: "Interactive tutorial",
  steps: {
    welcome: {
      title: "Welcome!",
      text: "Server Power Manager centralizes your servers and services for simplified management. This tour quickly covers each tab using your own sidebar.",
    },
    dashboard: {
      title: "Dashboard",
      text: "Overview of your servers: status, resource usage and active alerts, at a glance.",
    },
    servers: {
      title: "Servers",
      text: "Add your servers and wake them up remotely with Wake-on-LAN, directly from their card.",
    },
    console: {
      title: "Console",
      text: "Built-in terminal: run saved commands on your servers directly from the application.",
    },
    batch: {
      title: "Batch tasks",
      text: "Run the same action on several servers at once: the actual command adapts to each target's OS.",
    },
    network: {
      title: "Network",
      text: "Scan your network and visualize the topology, from the box down to each connected machine.",
    },
    alerts: {
      title: "Alerts",
      text: "Get notified when a server goes offline or exceeds a resource threshold.",
    },
    customization: {
      title: "Favorites & customization",
      text: "Drag a tab into the Favorites zone to pin it at the top of the sidebar, in the order you want.",
    },
    settings: {
      title: "Settings",
      text: "Find updates, issue reporting and project support here.",
    },
  },
  prev: "Previous",
  next: "Next",
  skip: "Skip the tutorial",
  done: "Done",
  try: "Try it",
  progress: "{current} / {total}",
  examples: {
    heading: "Example",
    servers: {
      name: "srv-plex",
      wol: "Wake up (WoL)",
      offline: "Offline",
      online: "Online",
    },
    dashboard: {
      onlineLabel: "Online",
      cpuLabel: "CPU",
      ramLabel: "RAM",
    },
    console: {
      command: "uptime",
      output: "14:21 up 14 days, load average: 0.08, 0.05, 0.01",
    },
    batch: {
      action: "Update",
      debian: "Debian",
      alpine: "Alpine",
      windows: "Windows",
      target1: "srv-web",
      target2: "srv-nas",
      target3: "pc-win",
    },
    network: {
      box: "Box",
      switch: "Switch",
      machine1: "PC 1",
      machine2: "PC 2",
    },
    alerts: {
      toggleLabel: "Alerts enabled",
      toastTitle: "Server offline",
      toastMessage: "srv-nas is not responding",
    },
    customization: {
      tabLabel: "Console",
      favoritesLabel: "Favorites",
    },
  },
};

/** "What's new" modal */
export const whatsNew: Dict["whatsNew"] = {
  title: "What's new in version {version}",
  close: "Close",
  newBadge: "New",
  discover: "Discover",
};

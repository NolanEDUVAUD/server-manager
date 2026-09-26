import type { Dict } from "..";

export const shortcuts: Dict["shortcuts"] = {
  groups: {
    general: "General",
    palette: "Command palette",
    pages: "Servers page",
    navigation: "Navigation",
  },
  desc: {
    palette: "Open or close the command palette",
    close: "Close the palette, the help or the confirmation prompt",
    paletteNext: "Next result",
    palettePrev: "Previous result",
    paletteRun: "Run the selected action (actions on a server ask for confirmation)",
    lock: "Lock the application (if a lock is configured)",
    help: "Show this help",
    search: "Jump to search (Servers page)",
    goDashboard: "Go to the dashboard",
    goServers: "Go to servers",
    goConsole: "Go to the SSH console",
    goSettings: "Go to settings",
  },
  keys: {
    escape: "Esc",
    enter: "Enter",
    shift: "Shift",
  },
  lockCombo: "Ctrl+Shift+L",
  title: "Keyboard shortcuts",
  closeHelp: "Close help",
  then: "then",
  note:
    "Single-key shortcuts (\"?\", \"/\", \"g\" then a letter) are ignored while typing in a field or in the SSH console.",
};
